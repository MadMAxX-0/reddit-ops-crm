import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { OfConversion, OfFollowerCount, OnlyFansProvider } from './types'

/**
 * Stand-in for the OnlyFans API.
 *
 * It derives conversions from real outbound clicks rather than inventing them,
 * so the causal chain the product claims — landing → outbound → subscription —
 * actually holds in development data. A simulator that produced subs with no
 * click behind them would make every funnel number a lie.
 */
export class SimulatedOnlyFansProvider implements OnlyFansProvider {
  readonly name = 'simulated-of'

  private hash01(s: string) {
    return crypto.createHash('sha256').update(s).digest().readUInt32BE(0) / 0xffffffff
  }

  async listConversions(since: Date): Promise<OfConversion[]> {
    const outbound = await prisma.funnelEvent.findMany({
      where: { type: 'OUTBOUND', ts: { gte: since } },
      orderBy: { ts: 'asc' },
      take: 5000,
      select: {
        id: true,
        ts: true,
        trackedLink: {
          select: {
            ofTrackingLinkId: true,
            redditAccount: { select: { assignedCreator: { select: { ofUsername: true } } } },
          },
        },
      },
    })

    const out: OfConversion[] = []
    for (const event of outbound) {
      const roll = this.hash01(`conv:${event.id}`)
      if (roll > 0.12) continue
      const ofUsername = event.trackedLink.redditAccount.assignedCreator?.ofUsername
      if (!ofUsername) continue

      const kindRoll = this.hash01(`kind:${event.id}`)
      const type =
        kindRoll < 0.46
          ? 'FREE_SUB'
          : kindRoll < 0.68
            ? 'TRIAL'
            : kindRoll < 0.86
              ? 'PAID_SUB'
              : kindRoll < 0.96
                ? 'PPV'
                : 'TIP'
      const amountCents =
        type === 'FREE_SUB'
          ? 0
          : type === 'TRIAL'
            ? [0, 0, 199, 299][Math.floor(this.hash01(`amt:${event.id}`) * 4)]
            : type === 'PAID_SUB'
              ? [699, 899, 999, 1299, 1499][Math.floor(this.hash01(`amt:${event.id}`) * 5)]
              : type === 'PPV'
                ? 400 + Math.floor(this.hash01(`amt:${event.id}`) * 4100)
                : 200 + Math.floor(this.hash01(`amt:${event.id}`) * 11800)

      out.push({
        externalId: `of_sim_${event.id}`,
        ofTrackingLinkId: event.trackedLink.ofTrackingLinkId,
        ofUsername,
        type,
        amountCents,
        occurredAt: new Date(
          Math.min(
            Date.now(),
            event.ts.getTime() + this.hash01(`delay:${event.id}`) * 48 * 3_600_000,
          ),
        ),
      })
    }
    return out
  }

  async listFollowerCounts(): Promise<OfFollowerCount[]> {
    const creators = await prisma.creator.findMany({
      where: { status: { not: 'CHURNED' } },
      select: { ofUsername: true, followerSnapshots: { orderBy: { ts: 'desc' }, take: 1 } },
    })
    const at = new Date()
    return creators.map((c) => ({
      ofUsername: c.ofUsername,
      followerCount: Math.max(
        0,
        (c.followerSnapshots[0]?.followerCount ?? 5000) +
          Math.round((this.hash01(`f:${c.ofUsername}:${at.toDateString()}`) - 0.35) * 90),
      ),
      at,
    }))
  }
}
