/** Fill mediaUrl / thumbnailUrl / selftext on posts discovered before the CRM kept them. */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { redditProvider } from '../src/lib/reddit'

async function main() {
  const provider = redditProvider()
  const posts = await prisma.post.findMany({
    where: { mediaUrl: null, thumbnailUrl: null },
    select: { id: true, redditPostId: true, title: true },
  })
  console.log(`${posts.length} posts without media`)

  let filled = 0
  for (const p of posts) {
    try {
      const s = await provider.getPost(p.redditPostId)
      if (!s.mediaUrl && !s.thumbnailUrl && !s.selftext) {
        console.log(`  – ${p.redditPostId} no media returned`)
        continue
      }
      await prisma.post.update({
        where: { id: p.id },
        data: { mediaUrl: s.mediaUrl, thumbnailUrl: s.thumbnailUrl, selftext: s.selftext },
      })
      filled++
      console.log(
        `  ✓ ${p.redditPostId} ${s.mediaType} ${s.thumbnailUrl ? 'thumb' : s.mediaUrl ? 'media' : 'text'}`,
      )
    } catch (e) {
      console.log(`  ! ${p.redditPostId}: ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`filled ${filled}/${posts.length}`)
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
