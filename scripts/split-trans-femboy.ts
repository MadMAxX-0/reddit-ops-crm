/**
 * Split the combined list into two working lists: Trans and Femboy.
 *
 *   npm run niche:split
 *
 * The rule the whole thing turns on: a femboy subreddit only joins the Trans
 * list if its OWN published rules say a trans woman may post there. Not if the
 * name sounds adjacent, not if it looks likely — if the mods wrote it down.
 * Every verdict below carries the sentence that decided it, so a ban can be
 * argued with the rules rather than with me.
 *
 * Three femboy subs bar trans women in so many words, and one of them
 * (r/ThiccFemboiss, 138k) says "IF YOU ARE TRANS YOU WILL BE BANNED" in its
 * sidebar. Those are exactly the rows a name-based split would have handed to a
 * model to post in.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

const SOURCE = 'Trans / Femboy'

/** Subreddits whose primary audience is femboy / sissy / trap / crossdresser. */
const FEMBOY_FAMILY = new Set([
  'FemBoys',
  'traps',
  'StraightToSissy',
  'Sissy_humiliation',
  'ForcedFeminization',
  'femboy',
  'Feminization',
  'trapsgonewild',
  'hungfemboys',
  'FemboyCum',
  'FemboyBussy',
  'PhatAssFemboys',
  'SissificationProject',
  'FemboyHookup',
  'TwinkFemboyPorn',
  'BBCFEMBOYS',
  'FemboySeduction',
  'CrossDresser_Closet',
  'BimboSissyDolls',
  'ThiccFemboiss',
  'EliteFemboy',
  'SissyWhitebois4BNWO',
  'FemboyFashion',
  'WildFemboys',
  'FemboyFuckdolls',
  'TrapsGoneWild2',
  'PureFemboy',
  'TrapsArentGay2',
  'FemboyFeetPics',
  'SissyGermany',
  'femboyfemdom',
  'FrontBackTraps',
  'femboyjerkbud',
  'SmallFemboys',
  'FemboyTomboyNSFW',
  'german_sissies',
  'girlsthatlikefemboys',
  'JerkbudsFemboy',
  'FemboyCulture',
  'FemboyThighPics2',
  'femboysforreal',
  'femboysEU',
  'Femboybrainwash',
  'femboymidriffs',
  'FemboyOrder',
  'GothFemboiz',
  'Femboys_4_women',
  'femboy_relationships',
  'FemboyCuties2',
  'FemboyRoyalty',
  'FemboySuperemacy',
  'FemboyFae',
  // dead, but they are still femboy subs and belong on the femboy list
  'SofterFemboys',
  'FemboyBreed',
  'onlyfemboy',
])

/** Subs whose rules name BOTH audiences — they belong on both lists. */
const BOTH: Record<string, string> = {
  Rearcock: 'Posts must contain mtf trans girl, or passable CD/Femboy ass and cock from behind',
  Femcock: 'Must be a trans girl, femboy or anyone presenting feminine with a cock',
  Tbutt: 'Must be trans, (or feminine and androgynous male ass)',
  TransGirlTrap: 'Only feminine/trans/femboy content',
  EverythingTrap_Trans: 'Posting of anything trap/trans related is allowed',
  FemboyShemaleBlowjobs: 'for posting Femboy, Shemale, Futa, Trap, Sissy … Blowjobs',
  TransGirlFleshlight: 'Must be a woman with a penis or a femboy',
  TransFrotting: 'Transwomen and femboys only',
  OnlyTrans: 'community for your favorite Trans and Femboy Content Creators',
  TransFem18: 'Inclusive Place for all Trans … Including FtM, MtF, Femboys, Crossdressers',
}

/** Femboy subs whose rules explicitly admit trans women. These join Trans. */
const TRANS_WELCOME: Record<string, string> = {
  femboy:
    'for feminine boys, androgynous people, enbies, trans people, and anyone who identifies as a femboy',
  FemBoys:
    'Poster must be a femboy or fem-presenting trans-woman/trans-man or androgynous non-binary creator',
  PhatAssFemboys:
    'Users must clearly be femboys, or femininely presenting trans-women/trans-men/non-binary',
  WildFemboys:
    'Users must clearly be femboys, or femininely presenting trans-women/trans-men/non-binary',
  TrapsGoneWild2: 'A place for trans people and feminine presenting folks (femboys, cds)',
  TrapsArentGay2: 'A place for trans people and feminine presenting folks (femboys, cds)',
  BimboSissyDolls: 'A sub for bimbo obsessed sissies/trans/admirers alike',
  FemboyTomboyNSFW: 'Trans/Nonbinary/Genderfluid people are welcome',
  FemboyCulture: 'rule: Femboys/Trans Content',
  FemboyThighPics2: 'Trans & others are welcome (trans women, Enby, etc)',
  femboysEU:
    'community for European femboys, trans, nonbinary … — but SFW ONLY, no nudity or bulges',
  FemboyOrder: 'femboys, furries and trans people can hangout — but NO 18+ content allowed',
}

/** Femboy subs whose rules explicitly bar trans women. These never join Trans. */
const TRANS_BARRED: Record<string, string> = {
  ThiccFemboiss: 'IF YOU ARE TRANS YOU WILL BE BANNED',
  femboysforreal: 'only femboys (cis and trans men, and masc enbies, NOT trans women) post',
  FemboyCuties2:
    'this space is for those who identify as "male", not on hrt — Transgirls are very welcome to post in r/TransGirl…',
  FemboyCum: 'MUST be a femboy that accepts male identifiers',
  FemboyBussy: "We're here for femme BOYS. r/TSobsession is our trans sister sub",
  EliteFemboy:
    'this is a subreddit solely for femboy content. If you are not a femboy please do not',
  FemboyFashion:
    'femboy is a feminine boy, a person who identifies as male and presents in a feminine way',
  FemboyFeetPics: 'Content is femboys only',
  FemboySeduction:
    'If you are a tran woman and are presenting as a woman … then you are not a femboy',
  FemboySuperemacy:
    'All content must center on celebrating femboy supremacy. And only femboys post',
  hungfemboys: 'Submitted pictures must feature a hung femboy, not just a big dick or a femboy',
}

async function ensure(name: string, color: string, note: string) {
  return prisma.subredditNiche.upsert({
    where: { name },
    update: { color, note },
    create: { name, color, note },
  })
}

async function main() {
  const items = await prisma.subredditNicheItem.findMany({
    where: { niche: { name: SOURCE } },
    select: { subreddit: true, note: true },
  })
  if (!items.length) {
    console.error(`nothing filed under "${SOURCE}"`)
    process.exit(1)
  }

  const trans = await ensure(
    'Trans',
    '#C084FC',
    'Trans-audience subreddits, plus the femboy subreddits whose own rules admit trans women.',
  )
  const femboy = await ensure(
    'Femboy',
    '#22D3EE',
    'Femboy / sissy / trap / crossdresser subreddits. Most are not trans-safe — check the note before assigning.',
  )

  let toTrans = 0
  let toFemboy = 0
  let crossed = 0
  let barred = 0
  let silent = 0

  for (const it of items) {
    const s = it.subreddit
    const isFemboy = FEMBOY_FAMILY.has(s)
    const isBoth = s in BOTH

    // note kept from the import (rule summary, "SFW posts allowed") and the
    // verdict prepended, because the verdict is what gets read first
    const keep = it.note
    const stamp = (verdict: string | null) => [verdict, keep].filter(Boolean).join(' — ') || null

    if (isBoth) {
      await file(trans.id, s, stamp(`TRANS OK · ${BOTH[s]}`))
      await file(femboy.id, s, stamp(`FEMBOY OK · ${BOTH[s]}`))
      toTrans++
      toFemboy++
      crossed++
      continue
    }

    if (!isFemboy) {
      await file(trans.id, s, stamp(null))
      toTrans++
      continue
    }

    // femboy family: the Femboy list always, the Trans list only on evidence
    if (s in TRANS_WELCOME) {
      await file(trans.id, s, stamp(`TRANS OK · ${TRANS_WELCOME[s]}`))
      await file(femboy.id, s, stamp(`TRANS OK · ${TRANS_WELCOME[s]}`))
      toTrans++
      toFemboy++
      crossed++
    } else if (s in TRANS_BARRED) {
      await file(femboy.id, s, stamp(`NO TRANS · ${TRANS_BARRED[s]}`))
      toFemboy++
      barred++
    } else {
      // Silence is not permission. It stays off the Trans list and says why.
      await file(femboy.id, s, stamp('TRANS NOT STATED · rules do not say either way'))
      toFemboy++
      silent++
    }
  }

  await prisma.subredditNiche.delete({ where: { name: SOURCE } })

  console.log(`Trans  : ${toTrans}`)
  console.log(`Femboy : ${toFemboy}`)
  console.log(`  of which on both lists          : ${crossed}`)
  console.log(`  femboy subs that BAR trans women: ${barred}`)
  console.log(`  femboy subs that say nothing    : ${silent}  (kept off Trans)`)
}

function file(nicheId: string, subreddit: string, note: string | null) {
  return prisma.subredditNicheItem.upsert({
    where: { nicheId_subreddit: { nicheId, subreddit } },
    update: { note },
    create: { nicheId, subreddit, note },
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
