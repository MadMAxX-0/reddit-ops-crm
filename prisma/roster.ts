/**
 * The real operation, as the team describes it.
 *
 * Account labels are stored exactly as the team writes them ("ZoeMain",
 * "Pinky2nd", "Lali") rather than normalised — reproducing their own shorthand
 * is what makes the grid readable to them at a glance.
 */

export const POSTERS = [
  { name: 'Bev', email: 'bev@agency.local' },
  { name: 'Leo', email: 'leo@agency.local' },
] as const

/**
 * One VA creates accounts, two warm them up. They share the FARMER role — the
 * work splits by habit rather than by permission, so a separate role would only
 * add a wall between people who cover for each other.
 */
export const FARMERS = [
  { name: 'VA — account creation', email: 'creation@agency.local', focus: 'creation' as const },
  { name: 'VA — farming 1', email: 'farming1@agency.local', focus: 'farming' as const },
  { name: 'VA — farming 2', email: 'farming2@agency.local', focus: 'farming' as const },
]

/** The models. One creator per person; the Main/2nd split lives on the account. */
export const MODELS = ['Lali', 'Annika', 'Zoe', 'Sandra', 'Pinky', 'Cristine', 'Leila'] as const

export interface RosterAccount {
  poster: string
  username: string
  /** verbatim label shown on the grid */
  modelLabel: string
  /** which model it actually fronts */
  model: (typeof MODELS)[number]
}

export const ACCOUNTS: RosterAccount[] = [
  { poster: 'Bev', username: 'Any-Statistician8376', modelLabel: 'Lali', model: 'Lali' },
  { poster: 'Bev', username: 'Due_Spare_8732', modelLabel: 'Annika', model: 'Annika' },
  { poster: 'Bev', username: 'Gold_Willingness_967', modelLabel: 'Zoe2nd', model: 'Zoe' },
  { poster: 'Bev', username: 'Knoxtrapph2019', modelLabel: 'Sandra', model: 'Sandra' },
  { poster: 'Bev', username: 'ScratchSerious4611', modelLabel: 'Pinky', model: 'Pinky' },
  { poster: 'Bev', username: 'SillySinx', modelLabel: 'ZoeMain', model: 'Zoe' },
  { poster: 'Bev', username: 'Slow-Pea2845', modelLabel: 'Pinky2nd', model: 'Pinky' },
  { poster: 'Leo', username: 'EmberPixelFox', modelLabel: 'Cristine2nd', model: 'Cristine' },
  { poster: 'Leo', username: 'FrostBeacon', modelLabel: 'Cristine', model: 'Cristine' },
  { poster: 'Leo', username: 'No_Oven8872', modelLabel: 'Leila', model: 'Leila' },
]
