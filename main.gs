/**
 * A Google app script that provides personal finance functions to a Google sheets file.
 * In your spreadsheet navigate to Extensions > App Script and add this file under Editor.
 * Then, you'll be able to use the functions here within cell calculations.
 * 
 * @see {@link https://github.com/cs-schmidt/expense-planner-scripts}
 */

/**
 * RESOURCES:
 * ------------------------------------------------------------------------ 
 * (1) General Resources:
 *     (1.1) Tax Tips (main tax calculator): https://www.taxtips.ca/calculators/canadian-tax/canadian-tax-calculator.htm
 * (2) Income Tax:
 *     (2.1) Canadian Income Tax Rates: https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html
 * (3) Tax Credits:
 *     (3.1) Federal Basic Personal Amount: https://www.taxtips.ca/filing/personal-amount-tax-credit.htm
 *     (3.2) Provincial Basic Personal Amount: https://www.taxtips.ca/non-refundable-personal-tax-credits.htm
 *     (3.3) Canada Employment Amount: https://www.taxtips.ca/filing/canada-employment-amount-tax-credit.htm
 * (4) CPP, CPP2, and EI:
 *     (4.1) CPP and CPP2:
 *           (4.1.1) https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html
 *           (4.1.2) https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html
 *           (4.1.3) https://www.taxtips.ca/cpp-qpp-and-ei/cpp-qpp-contribution-rates.htm#cpp-contributions-tax-return
 *     (4.2) EI: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html
 */

// NOTE: The functions herein a specific to Canada. Regular updates will be required to
//       keep results consistent with the Canadian tax code (see RESOURCES).

// Constants
// ************************************************************************

/** Federal income tax brackets (2.1 in RESOURCES). */
const FED_TAX_BRACKETS = new Map([
  [1, { max: 55867, rate: 0.15 }],
  [2, { max: 111733, rate: 0.205 }],
  [3, { max: 173205, rate: 0.26 }],
  [4, { max: 246752, rate: 0.29 }],
  [5, { max: Infinity, rate: 0.33 }],
]);

/** Provincial income tax brackets (2.1 in RESOURCES). */
const PROV_TAX_BRACKETS = new Map([
  [1, { max: 148269, rate: 0.1 }],
  [2, { max: 177922, rate: 0.12 }],
  [3, { max: 237230, rate: 0.13 }],
  [4, { max: 355845, rate: 0.14 }],
  [5, { max: Infinity, rate: 0.15 }],
]);

/** Minimum federal basic personal amount (3.1 in RESOURCES). */
const MIN_FBPA = 14156;

/** Maximum federal basic personal amount (3.1 in RESOURCES). */
const MAX_FBPA = 15705;

/** Provincial basic personal amount (3.2 in RESOURCES). */
const PBPA = 21885;

/** Canada employment amount (3.3 in RESOURCES). */
const CEBA = 1433;

/** CPP variables (4.1.1 and 4.1.3 in RESOURCES). */
const CPP = {
  PENSIONABLE_MAX: 68500,
  EXEMPTION: 3500,
  ADDED_RATE: 0.01,
  RATE: 0.0595,
};

/** CPP2 variables (4.1.2 and 4.1.3 in RESOURCES). */
const CPP2 = {
  PENSIONABLE_MAX: 73200,
  RATE: 0.04,
};

/** EI variables (4.2 in RESOURCES). */
const EI = {
  INSURABLE_MAX: 63200,
  RATE: 0.0166,
};

/**
 * The maximum portion of your gross earned income that could be deducted by payroll.
 * Letting 'G' represent gross earned income, you can derive this value by graphing the
 * total payroll deduction at G over G: this value should be the horizontal asymptote. It
 * should be a value in the range [0, 1).
 */
const MAX_PAYROLL_DEDUCTION_RATE = 0.5;

// Income
// ************************************************************************
/**
 * Computes wage needed to afford `annualExpense` at a given amount of `weeklyHours`.
 * @param {number} baseExpense Annual expenses before payroll deductions.
 * @param {number} weeklyHours Amount of hours worked each week.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function BREAK_EVEN_WAGE(baseExpense, weeklyHours, selfEmployed = false) {
  if (!_isNonNegativeNum(baseExpense)) throw Error("expense isn't a non-negative number");
  let upperIncome = baseExpense / (1 - MAX_PAYROLL_DEDUCTION_RATE);
  let lowerIncome = baseExpense;
  let middleIncome = (lowerIncome + upperIncome) / 2;
  let iterations = 0;
  const precision = 0.01;
  while (iterations <= 200 && Math.abs(upperIncome - lowerIncome) > precision) {
    const netIncome = middleIncome - TOTAL_PAYROLL_DEDUCTION(middleIncome, selfEmployed);
    if (netIncome > baseExpense) upperIncome = middleIncome;
    else if (netIncome < baseExpense) lowerIncome = middleIncome;
    else return middleIncome / (52 * weeklyHours);
    iterations += 1;
    middleIncome = (lowerIncome + upperIncome) / 2;
  }
  return middleIncome / (52 * weeklyHours);
}

/**
 * Computes taxable income.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function taxableIncome(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  return Math.max(earnedIncome - totalTaxDeduction(earnedIncome, selfEmployed), 0);
}

// Payroll Deductions
// ************************************************************************

/**
 * Computes total payroll deduction.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function TOTAL_PAYROLL_DEDUCTION(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  return [
    INCOME_TAX_OWED(earnedIncome, selfEmployed),
    TOTAL_CPP_CONTRIBUTION(earnedIncome, selfEmployed),
    EI_PREMIUM(earnedIncome, selfEmployed),
  ].reduce((sum, val) => sum + val);
}

/**
 * Computes total income tax you owed.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function INCOME_TAX_OWED(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  const taxableTotal = taxableIncome(earnedIncome, selfEmployed);
  const grossTaxOwed = grossFIT(taxableTotal) + grossPIT(taxableTotal);
  return Math.max(grossTaxOwed - totalTaxCredits(earnedIncome, selfEmployed), 0);
}

/**
 * Computes gross federal income tax.
 * @param {number} taxableIncome Taxable earned income.
 */
function grossFIT(taxableIncome) {
  if (!_isNonNegativeNum(taxableIncome)) throw Error("Input isn't a non-negative number");
  let result = 0;
  let bracket = 1;
  let bracketMin = 0;
  let bracketMax = FED_TAX_BRACKETS.get(bracket).max;
  let bracketRate = FED_TAX_BRACKETS.get(bracket).rate;
  while (taxableIncome > bracketMax && bracket < FED_TAX_BRACKETS.size) {
    result += (bracketMax - bracketMin) * bracketRate;
    bracketMin = bracketMax;
    bracket += 1;
    bracketMax = FED_TAX_BRACKETS.get(bracket).max;
    bracketRate = FED_TAX_BRACKETS.get(bracket).rate;
  }
  result += (taxableIncome - bracketMin) * bracketRate;
  return result;
}

/**
 * Computes gross provincial income tax.
 * @param {number} taxableIncome Taxable earned income.
 */
function grossPIT(taxableIncome) {
  if (!_isNonNegativeNum(taxableIncome)) throw Error("Input isn't a non-negative number");

  let grossPIT = 0;
  let bracket = 1;
  let bracketMin = 0;
  let bracketMax = PROV_TAX_BRACKETS.get(bracket).max;
  let bracketRate = PROV_TAX_BRACKETS.get(bracket).rate;
  while (taxableIncome > bracketMax && bracket < PROV_TAX_BRACKETS.size) {
    grossPIT += (bracketMax - bracketMin) * bracketRate;
    bracketMin = bracketMax;
    bracket += 1;
    bracketMax = PROV_TAX_BRACKETS.get(bracket).max;
    bracketRate = PROV_TAX_BRACKETS.get(bracket).rate;
  }
  grossPIT += (taxableIncome - bracketMin) * bracketRate;
  return grossPIT;
}

/**
 * Computes annual total CPP contribution.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function TOTAL_CPP_CONTRIBUTION(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  return (
    CPPContribution(earnedIncome, selfEmployed) +
    CPP2Contribution(earnedIncome, selfEmployed)
  );
}

/**
 * Computes annual CPP contribution.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CPPContribution(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  if (earnedIncome <= CPP.EXEMPTION) return 0;
  const pensionableTotal = Math.min(
    earnedIncome - CPP.EXEMPTION,
    CPP.PENSIONABLE_MAX - CPP.EXEMPTION
  );
  return selfEmployed ? pensionableTotal * 2 * CPP.RATE : pensionableTotal * CPP.RATE;
}

/**
 * Computes annual CPP2 contribution.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CPP2Contribution(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  if (earnedIncome <= CPP.PENSIONABLE_MAX) return 0;
  const pensionableTotal = Math.min(
    earnedIncome - CPP.PENSIONABLE_MAX,
    CPP2.PENSIONABLE_MAX - CPP.PENSIONABLE_MAX
  );
  return selfEmployed ? pensionableTotal * 2 * CPP2.RATE : pensionableTotal * CPP2.RATE;
}

/**
 * Computes annual employment insurance premium.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function EI_PREMIUM(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  if (selfEmployed) return 0;
  const insurableTotal = Math.min(earnedIncome, EI.INSURABLE_MAX);
  return insurableTotal * EI.RATE;
}

// Tax Deductions
// ************************************************************************

/**
 * Computes total tax deduction.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function totalTaxDeduction(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  return [
    baseCPPDeduction(earnedIncome, selfEmployed),
    enhancedCPPDeduction(earnedIncome, selfEmployed),
  ].reduce((sum, val) => sum + val);
}

/**
 * Computes base employee-side CPP contribution deduction: returns 0 unless self-employed.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function baseCPPDeduction(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  if (!selfEmployed) return 0;
  const employerBasePortion = (CPP.RATE - CPP.ADDED_RATE) / (2 * CPP.RATE);
  return employerBasePortion * CPPContribution(earnedIncome, selfEmployed);
}

/**
 * Computes enhanced CPP contribution deduction.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function enhancedCPPDeduction(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  return (
    (CPP.ADDED_RATE / CPP.RATE) * CPPContribution(earnedIncome, selfEmployed) +
    CPP2Contribution(earnedIncome, selfEmployed)
  );
}

// Tax Credits
// ************************************************************************

/**
 * Calculates total tax credits.
 * @param {number} taxableIncome Taxable earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function totalTaxCredits(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  return [
    FBPACredit(taxableIncome(earnedIncome, selfEmployed)),
    PBPACredit(),
    CEACredit(earnedIncome, selfEmployed),
    CPPContributionCredit(earnedIncome, selfEmployed),
    EIPremiumCredit(earnedIncome, selfEmployed),
  ].reduce((sum, val) => sum + val);
}

/**
 * Computes federal basic personal amount tax credit.
 * @param {number} taxableIncome Taxable earned income.
 */
function FBPACredit(taxableIncome) {
  if (!_isNonNegativeNum(taxableIncome)) throw Error("Input isn't a non-negative number");
  const diminishLower = FED_TAX_BRACKETS.get(3).max;
  const diminishUpper = FED_TAX_BRACKETS.get(4).max;
  if (taxableIncome <= diminishLower) return MAX_FBPA * FED_TAX_BRACKETS.get(1).rate;
  if (taxableIncome >= diminishUpper) return MIN_FBPA * FED_TAX_BRACKETS.get(1).rate;
  const additionalBPA = MAX_FBPA - MIN_FBPA;
  const diminishRate = additionalBPA / (diminishUpper - diminishLower);
  return (
    (MIN_FBPA + additionalBPA - (taxableIncome - diminishLower) * diminishRate) *
    FED_TAX_BRACKETS.get(1).rate
  );
}

/** Computes provincial basic personal amount tax credit. */
function PBPACredit() {
  return PBPA * PROV_TAX_BRACKETS.get(1).rate;
}

/**
 * Computes Canada employment amount tax credit.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CEACredit(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  if (selfEmployed) return 0;
  const base = Math.min(CEBA, earnedIncome);
  return base * FED_TAX_BRACKETS.get(1).rate;
}

/**
 * Computes (total) CPP contribution tax credit.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function CPPContributionCredit(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  const creditRate = FED_TAX_BRACKETS.get(1).rate + PROV_TAX_BRACKETS.get(1).rate;
  const base =
    TOTAL_CPP_CONTRIBUTION(earnedIncome, selfEmployed) -
    enhancedCPPDeduction(earnedIncome, selfEmployed);
  return creditRate * (selfEmployed ? 0.5 * base : base);
}

/**
 * Computes (total) EI premium tax credit.
 * @param {number} earnedIncome Gross earned income.
 * @param {boolean} [selfEmployed=false] Either self-employed (true) or employee (false).
 */
function EIPremiumCredit(earnedIncome, selfEmployed = false) {
  if (!_isNonNegativeNum(earnedIncome)) throw Error("income isn't a non-negative number");
  const creditRate = FED_TAX_BRACKETS.get(1).rate + PROV_TAX_BRACKETS.get(1).rate;
  return creditRate * EI_PREMIUM(earnedIncome, selfEmployed);
}

// PRIVATE FUNCTIONS
// ************************************************************************

function _isNonNegativeNum(num) {
  return typeof num == 'number' && num >= 0;
}
