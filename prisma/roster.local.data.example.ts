/**
 * The real operation, as the team describes it. Copy to `roster.local.data.ts` and fill in. This example names no
 * live promotion accounts and the models behind them, which is the one list a
 * competitor would actually use. `roster.local.data.example.ts` shows the
 * shape.
 *
 * Account labels are stored exactly as the team writes them ("ZoeMain",
 * "Pinky2nd", "ModelD") rather than normalised — reproducing their own shorthand
 * is what makes the grid readable to them at a glance.
 */

export const POSTERS = [
  { name: 'VaOne', email: 'bev@agency.local' },
  { name: 'VaTwo', email: 'leo@agency.local' },
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
export const MODELS = [
  'ModelD',
  'ModelA',
  'ModelG',
  'ModelB',
  'ModelF',
  'ModelC',
  'ModelE',
] as const

export interface RosterAccount {
  poster: string
  username: string
  /** verbatim label shown on the grid */
  modelLabel: string
  /** which model it actually fronts */
  model: (typeof MODELS)[number]
}

export const ACCOUNTS: RosterAccount[] = [
  { poster: 'VaOne', username: 'account_one', modelLabel: 'ModelD', model: 'ModelD' },
  { poster: 'VaOne', username: 'account_two', modelLabel: 'ModelA', model: 'ModelA' },
  { poster: 'VaOne', username: 'account_five', modelLabel: 'Zoe2nd', model: 'ModelG' },
  { poster: 'VaOne', username: 'account_six', modelLabel: 'ModelB', model: 'ModelB' },
  { poster: 'VaOne', username: 'account_eight', modelLabel: 'ModelF', model: 'ModelF' },
  { poster: 'VaOne', username: 'account_nine', modelLabel: 'ZoeMain', model: 'ModelG' },
  { poster: 'VaOne', username: 'account_ten', modelLabel: 'Pinky2nd', model: 'ModelF' },
  { poster: 'VaTwo', username: 'account_three', modelLabel: 'Cristine2nd', model: 'ModelC' },
  { poster: 'VaTwo', username: 'account_four', modelLabel: 'ModelC', model: 'ModelC' },
  { poster: 'VaTwo', username: 'account_seven', modelLabel: 'ModelE', model: 'ModelE' },
]
