/**
 * Resources:
 * ------------------------------------------------------------------------
 * - https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/payroll-deductions-online-calculator.html
 *
 * - Income Tax:
 *   - https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html
 *
 * - CPP and CPP2:
 *   - https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html
 *   - https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html
 *   - https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp.html#h_10
 *
 * - EI:
 *   - https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html
 *
 * - CPP Tax Deductions:
 *   - https://www.taxtips.ca/cpp-qpp-and-ei/cpp-qpp-contribution-rates.htm#cpp-contributions-tax-return
 *
 * - Federal Basic Personal Amount
 *   - https://www.taxtips.ca/filing/personal-amount-tax-credit.htm
 *
 * - Canada Employment Amount
 *   - https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31260-canada-employment-amount.html
 *   - https://www.taxtips.ca/filing/canada-employment-amount-tax-credit.htm
 */

// NOTE: Update regularly to keep constants and functions aligned with Canadian tax code.

// CONSTANTS
// ************************************************************************
const FEDERAL_TAX_BRACKETS = new Map([
  [1, { max: 55867, rate: 0.15 }],
  [2, { max: 111733, rate: 0.205 }],
  [3, { max: 173205, rate: 0.26 }],
  [4, { max: 246752, rate: 0.29 }],
  [5, { max: Infinity, rate: 0.33 }],
]);

const STATE_TAX_BRACKETS = new Map([
  [1, { max: 148269, rate: 0.1 }],
  [2, { max: 177922, rate: 0.12 }],
  [3, { max: 237230, rate: 0.13 }],
  [4, { max: 355845, rate: 0.14 }],
  [5, { max: Infinity, rate: 0.15 }],
]);

const MIN_FBPA = 14156;
const MAX_FBPA = 15705;
const PBPA = 21885;
const CEBA = 1433;

const CPP = {
  PENSIONABLE_MAX: 68500,
  EXEMPTION: 3500,
  ADDED_RATE: 0.01,
  RATE: 0.0595,
};

const CPP2 = {
  PENSIONABLE_MAX: 73200,
  RATE: 0.04,
};

const EI = {
  INSURABLE_MAX: 63200,
  RATE: 0.0166,
};

const MAX_PAYROLL_DEDUCTION_RATE = 0.5;

// ???
// ************************************************************************
/**
 * Computes the wage needed to afford `annualExpense` at a given amount of `weeklyHours`.
 * @param {number} baseExpense Annual expenses before payroll deductions.
 * @param {number} weeklyHours Amount of hours worked each week.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function BREAK_EVEN_WAGE(baseExpense, weeklyHours, selfEmployed = false) {
  if (!_isNonNegativeNum(baseExpense))
    throw Error("Base expense isn't a nonnegative number");
  let upper = baseExpense / (1 - MAX_PAYROLL_DEDUCTION_RATE);
  let lower = baseExpense;
  let middle = (lower + upper) / 2;
  let iterations = 0;
  while (Math.abs(upper - lower) > 0.01 && iterations <= 200) {
    const netIncome = middle - TOTAL_PAYROLL_DEDUCTION(middle, selfEmployed);
    if (netIncome > baseExpense) upper = middle;
    else if (netIncome < baseExpense) lower = middle;
    else return middle / (52 * weeklyHours);
    iterations += 1;
    middle = (lower + upper) / 2;
  }
  return middle / (52 * weeklyHours);
}

function TOTAL_PAYROLL_DEDUCTION(earnedIncome, selfEmployed = false) {
  return [
    INCOME_TAX_OWED(earnedIncome, selfEmployed),
    TOTAL_CPP_CONTRIBUTION(earnedIncome, selfEmployed),
    EI_PREMIUM(earnedIncome, selfEmployed),
  ].reduce((sum, val) => sum + val, 0);
}

// Income Tax Functions
// ************************************************************************
/**
 * Computes total income tax you owed.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function INCOME_TAX_OWED(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("Input isn't a nonnegative number");
  const taxableIncome = earnedIncome - totalTaxDeduction(earnedIncome, selfEmployed);
  const grossTaxOwed = grossFIT(taxableIncome) + grossPIT(taxableIncome);
  return Math.max(grossTaxOwed - totalTaxCredits(earnedIncome, selfEmployed), 0);
}

/**
 * Computes gross federal income tax.
 * @param {number} taxableIncome
 */
function grossFIT(taxableIncome) {
  let result = 0;
  let bracket = 1;
  let bracketMin = 0;
  let bracketMax = FEDERAL_TAX_BRACKETS.get(bracket).max;
  let bracketRate = FEDERAL_TAX_BRACKETS.get(bracket).rate;
  while (taxableIncome > bracketMax && bracket < FEDERAL_TAX_BRACKETS.size) {
    result += (bracketMax - bracketMin) * bracketRate;
    bracketMin = bracketMax;
    bracket += 1;
    bracketMax = FEDERAL_TAX_BRACKETS.get(bracket).max;
    bracketRate = FEDERAL_TAX_BRACKETS.get(bracket).rate;
  }
  result += (taxableIncome - bracketMin) * bracketRate;
  return result;
}

/**
 * Computes gross provincial income tax.
 * @param {number} taxableIncome
 */
function grossPIT(taxableIncome) {
  let grossPIT = 0;
  let bracket = 1;
  let bracketMin = 0;
  let bracketMax = STATE_TAX_BRACKETS.get(bracket).max;
  let bracketRate = STATE_TAX_BRACKETS.get(bracket).rate;
  while (taxableIncome > bracketMax && bracket < STATE_TAX_BRACKETS.size) {
    grossPIT += (bracketMax - bracketMin) * bracketRate;
    bracketMin = bracketMax;
    bracket += 1;
    bracketMax = STATE_TAX_BRACKETS.get(bracket).max;
    bracketRate = STATE_TAX_BRACKETS.get(bracket).rate;
  }
  grossPIT += (taxableIncome - bracketMin) * bracketRate;
  return grossPIT;
}

// Tax Deductions
// ************************************************************************
/**
 * Computes total tax deduction.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function totalTaxDeduction(earnedIncome, selfEmployed = false) {
  return [
    baseCPPDeduction(earnedIncome, selfEmployed),
    enhancedCPPDeduction(earnedIncome, selfEmployed),
  ].reduce((sum, val) => sum + val, 0);
}

/**
 * Computes base employee-side CPP contribution deduction: returns 0 unless self-employed.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function baseCPPDeduction(earnedIncome, selfEmployed = false) {
  if (!selfEmployed) return 0;
  const employerBasePortion = (CPP.RATE - CPP.ADDED_RATE) / (2 * CPP.RATE);
  return employerBasePortion * CPPContribution(earnedIncome, selfEmployed);
}

/**
 * Computes enhanced CPP contribution deduction.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function enhancedCPPDeduction(earnedIncome, selfEmployed = false) {
  return (
    (CPP.ADDED_RATE / CPP.RATE) * CPPContribution(earnedIncome, selfEmployed) +
    CPP2Contribution(earnedIncome, selfEmployed)
  );
}

// Tax Credits
// ************************************************************************
/**
 * Calculates total tax credits.
 * @param {number} taxableIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function totalTaxCredits(earnedIncome, selfEmployed = false) {
  const taxableIncome = earnedIncome - totalTaxDeduction(earnedIncome, selfEmployed);
  return [
    FBPACredit(taxableIncome),
    PBPACredit(),
    CEACredit(earnedIncome, selfEmployed),
    CPPContributionCredit(earnedIncome, selfEmployed),
    EIPremiumCredit(earnedIncome, selfEmployed),
  ].reduce((sum, val) => sum + val, 0);
}

/**
 * Computes federal basic personal amount tax credit.
 * @param {number} taxableIncome
 */
function FBPACredit(taxableIncome) {
  let BPA = 0;
  const AFBPA = MAX_FBPA - MIN_FBPA;
  const diminishLower = FEDERAL_TAX_BRACKETS.get(3).max;
  const diminishUpper = FEDERAL_TAX_BRACKETS.get(4).max;
  if (taxableIncome <= diminishLower) BPA = MAX_FBPA;
  else if (taxableIncome >= diminishUpper) BPA = MIN_FBPA;
  else {
    const diminishRate = AFBPA / (diminishUpper - diminishLower);
    BPA = MIN_FBPA + AFBPA - (taxableIncome - diminishLower) * diminishRate;
  }
  return BPA * FEDERAL_TAX_BRACKETS.get(1).rate;
}

/** Computes provincial basic personal amount tax credit. */
function PBPACredit() {
  return PBPA * STATE_TAX_BRACKETS.get(1).rate;
}

/**
 * Computes Canadian employment amount tax credit.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CEACredit(earnedIncome, selfEmployed = false) {
  if (selfEmployed) return 0;
  return Math.min(CEBA, earnedIncome) * FEDERAL_TAX_BRACKETS.get(1).rate;
}

/**
 * Computes CPP contribution tax credit.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CPPContributionCredit(earnedIncome, selfEmployed = false) {
  const creditRate = FEDERAL_TAX_BRACKETS.get(1).rate + STATE_TAX_BRACKETS.get(1).rate;
  const base =
    TOTAL_CPP_CONTRIBUTION(earnedIncome, selfEmployed) -
    enhancedCPPDeduction(earnedIncome, selfEmployed);
  return creditRate * (!selfEmployed ? base : 0.5 * base);
}

/**
 * Computes EI premium tax credit.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function EIPremiumCredit(earnedIncome, selfEmployed = false) {
  const creditRate = FEDERAL_TAX_BRACKETS.get(1).rate + STATE_TAX_BRACKETS.get(1).rate;
  const premium = EI_PREMIUM(earnedIncome, selfEmployed);
  return creditRate * premium;
}

// CPP Functions
// ************************************************************************
/**
 * Computes annual total CPP contribution.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function TOTAL_CPP_CONTRIBUTION(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("Input isn't a nonnegative number");
  return (
    CPPContribution(earnedIncome, selfEmployed) +
    CPP2Contribution(earnedIncome, selfEmployed)
  );
}

/**
 * Computes annual CPP contribution.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CPPContribution(earnedIncome, selfEmployed = false) {
  if (earnedIncome <= CPP.EXEMPTION) return 0;
  const pensionableTotal = Math.min(
    CPP.PENSIONABLE_MAX - CPP.EXEMPTION,
    earnedIncome - CPP.EXEMPTION
  );
  return !selfEmployed ? pensionableTotal * CPP.RATE : pensionableTotal * 2 * CPP.RATE;
}

/**
 * Computes annual CPP2 contribution.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CPP2Contribution(earnedIncome, selfEmployed = false) {
  if (earnedIncome <= CPP.PENSIONABLE_MAX) return 0;
  const pensionableTotal = Math.min(
    earnedIncome - CPP.PENSIONABLE_MAX,
    CPP2.PENSIONABLE_MAX - CPP.PENSIONABLE_MAX
  );
  return !selfEmployed ? pensionableTotal * CPP2.RATE : pensionableTotal * 2 * CPP2.RATE;
}

// EI Functions
// ************************************************************************
/**
 * Computes annual employment insurance premium.
 * @param {number} earnedIncome
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function EI_PREMIUM(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("Input isn't a nonnegative number");
  if (selfEmployed) return 0;
  const insurableTotal = Math.min(earnedIncome, EI.INSURABLE_MAX);
  return insurableTotal * EI.RATE;
}

// Private Functions
// ************************************************************************
function _isNonNegativeNum(num) {
  return typeof num == 'number' && num >= 0;
}
