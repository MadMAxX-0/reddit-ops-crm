export type OfConversionType = 'FREE_SUB' | 'TRIAL' | 'PAID_SUB' | 'PPV' | 'TIP'

export interface OfConversion {
  /** OF's own id — the idempotency key for the sync */
  externalId: string
  /** the per-Reddit-account tracking link OF attributed this to */
  ofTrackingLinkId: string | null
  ofUsername: string
  type: OfConversionType
  amountCents: number
  occurredAt: Date
}

export interface OfFollowerCount {
  ofUsername: string
  followerCount: number
  at: Date
}

export interface OnlyFansProvider {
  readonly name: string
  /** Everything that happened since `since`, across all creators on the account. */
  listConversions(since: Date): Promise<OfConversion[]>
  listFollowerCounts(): Promise<OfFollowerCount[]>
}
