/** Static reference data for the seed. Kept apart so seed.ts stays readable. */

export const SUBREDDITS: Array<{
  name: string
  subscribers: number
  verificationRequired: boolean
  minKarma: number
  minAccountAgeDays: number
  postCooldownHours: number
  tier: 'S' | 'A' | 'B' | 'C'
  status: 'ACTIVE' | 'RISKY' | 'BANNED_FOR_US'
  flairs: string[]
  rules: string
}> = [
  { name: 'OnlyFansPromo', subscribers: 412_000, verificationRequired: true, minKarma: 50, minAccountAgeDays: 30, postCooldownHours: 24, tier: 'S', status: 'ACTIVE', flairs: ['Promo', 'Free Page'], rules: 'Verification required. One post per 24h. No linking in title.' },
  { name: 'onlyfansadvice', subscribers: 289_000, verificationRequired: true, minKarma: 100, minAccountAgeDays: 60, postCooldownHours: 48, tier: 'S', status: 'ACTIVE', flairs: ['Promo', 'Discussion'], rules: 'Heavy mod presence. Promo only in weekly thread outside Fridays.' },
  { name: 'AdultContentExchange', subscribers: 156_000, verificationRequired: false, minKarma: 25, minAccountAgeDays: 14, postCooldownHours: 12, tier: 'A', status: 'ACTIVE', flairs: ['Selling', 'Promo'], rules: 'No repost within 12h. Title must include price range.' },
  { name: 'NSFWverifiedamateurs', subscribers: 224_000, verificationRequired: true, minKarma: 75, minAccountAgeDays: 45, postCooldownHours: 24, tier: 'S', status: 'ACTIVE', flairs: ['Verified', 'OC'], rules: 'Verification post required before any submission.' },
  { name: 'SexSells', subscribers: 1_100_000, verificationRequired: true, minKarma: 200, minAccountAgeDays: 90, postCooldownHours: 168, tier: 'S', status: 'RISKY', flairs: ['Selling'], rules: 'One post per week. Verification mandatory. Instant ban on rule 3.' },
  { name: 'creatorpromo', subscribers: 88_000, verificationRequired: false, minKarma: 10, minAccountAgeDays: 7, postCooldownHours: 6, tier: 'A', status: 'ACTIVE', flairs: ['Promo'], rules: 'Low friction. Good for warming new accounts.' },
  { name: 'fansly_promo', subscribers: 64_000, verificationRequired: false, minKarma: 5, minAccountAgeDays: 3, postCooldownHours: 8, tier: 'B', status: 'ACTIVE', flairs: ['Promo', 'Free'], rules: 'No karma floor in practice.' },
  { name: 'AmateurNSFW', subscribers: 340_000, verificationRequired: false, minKarma: 50, minAccountAgeDays: 30, postCooldownHours: 24, tier: 'A', status: 'ACTIVE', flairs: ['OC', 'Amateur'], rules: 'OC only, watermark tolerated.' },
  { name: 'gonewild30plus', subscribers: 512_000, verificationRequired: true, minKarma: 150, minAccountAgeDays: 60, postCooldownHours: 48, tier: 'A', status: 'ACTIVE', flairs: ['Verified'], rules: 'Age verification enforced by mods.' },
  { name: 'RealGirls', subscribers: 2_400_000, verificationRequired: false, minKarma: 300, minAccountAgeDays: 90, postCooldownHours: 72, tier: 'S', status: 'RISKY', flairs: [], rules: 'No promo of any kind in title or comments. High removal rate.' },
  { name: 'petitegonewild', subscribers: 780_000, verificationRequired: true, minKarma: 100, minAccountAgeDays: 45, postCooldownHours: 24, tier: 'A', status: 'ACTIVE', flairs: ['Verified'], rules: 'Verification required.' },
  { name: 'nsfwpromo', subscribers: 45_000, verificationRequired: false, minKarma: 0, minAccountAgeDays: 1, postCooldownHours: 4, tier: 'C', status: 'ACTIVE', flairs: ['Promo'], rules: 'Anything goes. Low conversion, useful for karma.' },
  { name: 'OnlyFansPromotions', subscribers: 132_000, verificationRequired: false, minKarma: 20, minAccountAgeDays: 14, postCooldownHours: 12, tier: 'B', status: 'ACTIVE', flairs: ['Promo'], rules: 'Two posts per day maximum.' },
  { name: 'SellingPics', subscribers: 71_000, verificationRequired: true, minKarma: 40, minAccountAgeDays: 21, postCooldownHours: 24, tier: 'B', status: 'ACTIVE', flairs: ['Selling'], rules: 'Price must be in title.' },
  { name: 'onlyfansgirls101', subscribers: 198_000, verificationRequired: false, minKarma: 30, minAccountAgeDays: 14, postCooldownHours: 12, tier: 'A', status: 'ACTIVE', flairs: ['Promo', 'Free Trial'], rules: 'Free trial links convert best here.' },
  { name: 'FreeOnlyFansGirls', subscribers: 118_000, verificationRequired: false, minKarma: 10, minAccountAgeDays: 7, postCooldownHours: 8, tier: 'B', status: 'ACTIVE', flairs: ['Free'], rules: 'Free pages only. Paid pages removed.' },
  { name: 'AdultEntertainers', subscribers: 96_000, verificationRequired: true, minKarma: 60, minAccountAgeDays: 30, postCooldownHours: 24, tier: 'B', status: 'ACTIVE', flairs: ['Promo', 'Advice'], rules: 'Industry-focused. Softer promo tone works better.' },
  { name: 'promoteonlyfans', subscribers: 52_000, verificationRequired: false, minKarma: 0, minAccountAgeDays: 1, postCooldownHours: 6, tier: 'C', status: 'ACTIVE', flairs: [], rules: 'Very low signal.' },
  { name: 'nsfw_amateurs', subscribers: 265_000, verificationRequired: false, minKarma: 45, minAccountAgeDays: 21, postCooldownHours: 24, tier: 'B', status: 'ACTIVE', flairs: ['OC'], rules: 'Standard NSFW rules.' },
  { name: 'onlyfansbabes', subscribers: 145_000, verificationRequired: false, minKarma: 25, minAccountAgeDays: 14, postCooldownHours: 12, tier: 'B', status: 'ACTIVE', flairs: ['Promo'], rules: 'No rule enforcement observed.' },
  { name: 'GoneWildPlus', subscribers: 430_000, verificationRequired: true, minKarma: 120, minAccountAgeDays: 60, postCooldownHours: 48, tier: 'A', status: 'ACTIVE', flairs: ['Verified'], rules: 'Verification and karma both enforced.' },
  { name: 'slutsofsnapchat', subscribers: 210_000, verificationRequired: false, minKarma: 35, minAccountAgeDays: 21, postCooldownHours: 24, tier: 'C', status: 'RISKY', flairs: [], rules: 'Mod team inconsistent; removals spike without warning.' },
  { name: 'BustyPetite', subscribers: 1_800_000, verificationRequired: true, minKarma: 250, minAccountAgeDays: 90, postCooldownHours: 72, tier: 'S', status: 'ACTIVE', flairs: ['Verified'], rules: 'Large reach, strict verification.' },
  { name: 'collegesluts', subscribers: 690_000, verificationRequired: true, minKarma: 150, minAccountAgeDays: 60, postCooldownHours: 48, tier: 'A', status: 'ACTIVE', flairs: ['Verified'], rules: 'Age proof required.' },
  { name: 'AsiansGoneWild', subscribers: 540_000, verificationRequired: true, minKarma: 100, minAccountAgeDays: 45, postCooldownHours: 24, tier: 'A', status: 'ACTIVE', flairs: ['Verified'], rules: 'Verification required.' },
  { name: 'LatinasGoneWild', subscribers: 380_000, verificationRequired: true, minKarma: 90, minAccountAgeDays: 45, postCooldownHours: 24, tier: 'B', status: 'ACTIVE', flairs: ['Verified'], rules: 'Verification required.' },
  { name: 'onlyfans101', subscribers: 76_000, verificationRequired: false, minKarma: 15, minAccountAgeDays: 7, postCooldownHours: 8, tier: 'C', status: 'ACTIVE', flairs: ['Promo'], rules: 'Volume play.' },
  { name: 'ofmodels', subscribers: 41_000, verificationRequired: false, minKarma: 10, minAccountAgeDays: 7, postCooldownHours: 6, tier: 'C', status: 'ACTIVE', flairs: [], rules: 'Small but converts above its size.' },
  { name: 'thickchicks', subscribers: 620_000, verificationRequired: false, minKarma: 80, minAccountAgeDays: 30, postCooldownHours: 24, tier: 'B', status: 'ACTIVE', flairs: [], rules: 'No promo in title.' },
  { name: 'nsfwcosplay', subscribers: 490_000, verificationRequired: true, minKarma: 100, minAccountAgeDays: 45, postCooldownHours: 24, tier: 'A', status: 'ACTIVE', flairs: ['Cosplay'], rules: 'Cosplay only; niche fits two of our creators.' },
  { name: 'GirlsFinishingTheJob', subscribers: 1_200_000, verificationRequired: true, minKarma: 200, minAccountAgeDays: 90, postCooldownHours: 72, tier: 'S', status: 'ACTIVE', flairs: ['Verified'], rules: 'Very high reach, very strict.' },
  { name: 'PornStarletHQ', subscribers: 310_000, verificationRequired: true, minKarma: 150, minAccountAgeDays: 60, postCooldownHours: 48, tier: 'B', status: 'ACTIVE', flairs: [], rules: 'Professional content preferred.' },
  { name: 'OnlyFansLinks', subscribers: 58_000, verificationRequired: false, minKarma: 5, minAccountAgeDays: 3, postCooldownHours: 6, tier: 'C', status: 'ACTIVE', flairs: ['Link'], rules: 'Direct links permitted.' },
  { name: 'freeonlyfans', subscribers: 92_000, verificationRequired: false, minKarma: 10, minAccountAgeDays: 7, postCooldownHours: 8, tier: 'B', status: 'ACTIVE', flairs: ['Free'], rules: 'Free pages only.' },
  { name: 'ofpromotion', subscribers: 37_000, verificationRequired: false, minKarma: 0, minAccountAgeDays: 1, postCooldownHours: 4, tier: 'C', status: 'ACTIVE', flairs: [], rules: 'Karma farm.' },
  { name: 'AdultPromoHub', subscribers: 29_000, verificationRequired: false, minKarma: 0, minAccountAgeDays: 1, postCooldownHours: 4, tier: 'C', status: 'BANNED_FOR_US', flairs: [], rules: 'Mods banned our domain in April. Do not post.' },
  { name: 'gonewildaudio', subscribers: 810_000, verificationRequired: true, minKarma: 180, minAccountAgeDays: 60, postCooldownHours: 48, tier: 'B', status: 'ACTIVE', flairs: ['Audio'], rules: 'Audio only. One creator uses this.' },
  { name: 'tributeme', subscribers: 145_000, verificationRequired: false, minKarma: 50, minAccountAgeDays: 30, postCooldownHours: 24, tier: 'C', status: 'RISKY', flairs: [], rules: 'Removal rate climbing since June.' },
  { name: 'snapchatpremium', subscribers: 178_000, verificationRequired: false, minKarma: 40, minAccountAgeDays: 21, postCooldownHours: 12, tier: 'B', status: 'ACTIVE', flairs: ['Selling'], rules: 'Cross-sells well with free pages.' },
  { name: 'CamSluts', subscribers: 405_000, verificationRequired: true, minKarma: 120, minAccountAgeDays: 45, postCooldownHours: 24, tier: 'B', status: 'ACTIVE', flairs: ['Verified'], rules: 'Verification required.' },
]

export const CREATORS: Array<{ stageName: string; ofUsername: string; niche: string; sharePct: number; status: 'ACTIVE' | 'PAUSED' | 'CHURNED' }> = [
  { stageName: 'Mila Vane', ofUsername: 'milavane', niche: 'Girl next door', sharePct: 70, status: 'ACTIVE' },
  { stageName: 'Sasha Kane', ofUsername: 'sashakane', niche: 'Alt / tattoos', sharePct: 65, status: 'ACTIVE' },
  { stageName: 'Nova Reyes', ofUsername: 'novareyes', niche: 'Latina', sharePct: 70, status: 'ACTIVE' },
  { stageName: 'Ivy Lockhart', ofUsername: 'ivylockhart', niche: 'Cosplay', sharePct: 60, status: 'ACTIVE' },
  { stageName: 'Remy Cole', ofUsername: 'remycole', niche: 'Fitness', sharePct: 70, status: 'ACTIVE' },
  { stageName: 'Juno Park', ofUsername: 'junopark', niche: 'Asian', sharePct: 65, status: 'ACTIVE' },
  { stageName: 'Delphi Rae', ofUsername: 'delphirae', niche: 'Audio / GFE', sharePct: 75, status: 'PAUSED' },
  { stageName: 'Cass Wilder', ofUsername: 'casswilder', niche: 'MILF', sharePct: 70, status: 'ACTIVE' },
]

export const STAFF: Array<{
  name: string
  email: string
  role: 'POSTER' | 'FARMER' | 'MANAGER' | 'ADMIN'
  timezone: string
  accountGoal: number
  postGoal: number
  hourlyCostCents: number
}> = [
  { name: 'Adaeze Okonkwo', email: 'adaeze@northstar.dev', role: 'ADMIN', timezone: 'Asia/Dubai', accountGoal: 0, postGoal: 0, hourlyCostCents: 0 },
  { name: 'Tomas Berg', email: 'tomas@northstar.dev', role: 'MANAGER', timezone: 'Europe/Berlin', accountGoal: 0, postGoal: 0, hourlyCostCents: 3500 },
  { name: 'Priya Raman', email: 'priya@northstar.dev', role: 'MANAGER', timezone: 'Asia/Kolkata', accountGoal: 0, postGoal: 0, hourlyCostCents: 2800 },

  { name: 'Chinedu Eze', email: 'chinedu@northstar.dev', role: 'FARMER', timezone: 'Africa/Lagos', accountGoal: 35, postGoal: 0, hourlyCostCents: 450 },
  { name: 'Ngozi Balogun', email: 'ngozi@northstar.dev', role: 'FARMER', timezone: 'Africa/Lagos', accountGoal: 35, postGoal: 0, hourlyCostCents: 450 },
  { name: 'Kwame Mensah', email: 'kwame@northstar.dev', role: 'FARMER', timezone: 'Africa/Lagos', accountGoal: 30, postGoal: 0, hourlyCostCents: 420 },
  { name: 'Rina Salvador', email: 'rina@northstar.dev', role: 'FARMER', timezone: 'Asia/Manila', accountGoal: 35, postGoal: 0, hourlyCostCents: 500 },
  { name: 'Dmitri Volkov', email: 'dmitri@northstar.dev', role: 'FARMER', timezone: 'Europe/London', accountGoal: 25, postGoal: 0, hourlyCostCents: 700 },
  { name: 'Amara Nwosu', email: 'amara@northstar.dev', role: 'FARMER', timezone: 'Africa/Lagos', accountGoal: 35, postGoal: 0, hourlyCostCents: 450 },

  { name: 'Jules Marchand', email: 'jules@northstar.dev', role: 'POSTER', timezone: 'Europe/Berlin', accountGoal: 0, postGoal: 14, hourlyCostCents: 650 },
  { name: 'Bea Santos', email: 'bea@northstar.dev', role: 'POSTER', timezone: 'Asia/Manila', accountGoal: 0, postGoal: 16, hourlyCostCents: 520 },
  { name: 'Yusuf Adeyemi', email: 'yusuf@northstar.dev', role: 'POSTER', timezone: 'Africa/Lagos', accountGoal: 0, postGoal: 16, hourlyCostCents: 480 },
  { name: 'Lena Fischer', email: 'lena@northstar.dev', role: 'POSTER', timezone: 'Europe/Berlin', accountGoal: 0, postGoal: 12, hourlyCostCents: 680 },
  { name: 'Marco Ilagan', email: 'marco@northstar.dev', role: 'POSTER', timezone: 'Asia/Manila', accountGoal: 0, postGoal: 16, hourlyCostCents: 510 },
  { name: 'Zara Haddad', email: 'zara@northstar.dev', role: 'POSTER', timezone: 'Asia/Dubai', accountGoal: 0, postGoal: 14, hourlyCostCents: 600 },
]

export const TITLE_TEMPLATES = [
  'first time posting here, be nice 🙈',
  'do you think I could pull off this outfit?',
  '23 and finally comfortable in my own skin',
  'rate my new set? honest answers only',
  'my roommate said I would never post this',
  'is this too much for a monday?',
  'free page in bio, no card needed 💕',
  'tell me what you would do',
  'been told I have a girl-next-door face',
  'trying something new tonight',
  'nobody at work knows about this account',
  'should I keep going or stop here?',
  'the outfit stayed on for exactly 4 minutes',
  'looking for someone to talk to tonight',
  '5ft2 and still causing problems',
  'my ex hated when I did this',
  'first post since moving out 🏠',
  'quick one before my shift',
  'do you prefer the before or the after?',
  'this got removed from three subs already',
  'gym progress but make it nsfw',
  'the tan lines are real, I promise',
  'I get shy on camera, sorry',
  'free trial link is in my bio, 3 days only',
  'be honest — would you swipe?',
]

export const REMOVAL_REASONS = [
  'Rule 3 — promotional link in title',
  'Rule 1 — no verification on file',
  'Automod: account age below subreddit minimum',
  'Rule 7 — duplicate post within cooldown',
  'Removed by moderator, no reason given',
  'Spam filter — domain on subreddit blocklist',
  'Rule 2 — watermark not permitted',
]

export const EMAIL_PROVIDERS = ['gmx.com', 'mail.com', 'protonmail.com', 'outlook.com', 'tutanota.com']
export const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'SE', 'BR', 'MX', 'IN', 'PH']
export const DEVICES = ['mobile', 'mobile', 'mobile', 'mobile', 'desktop', 'tablet']
