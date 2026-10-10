// Original educational copy; formula IDs and example lineage reference InvestScape Docs 06/33/48.
import {remainingCatalog} from './remaining-catalog.js';
const text = (en, fr, hant, hans) => ({ en, 'fr-CA': fr, 'zh-Hant': hant, 'zh-Hans': hans });
export const categories = ['capital', 'time', 'cashflow', 'performance', 'leverage', 'development'];
export const locales = ['en', 'fr-CA', 'zh-Hant', 'zh-Hans'];
export const labels = {
  title: text('Library', 'Bibliothèque', '知識庫', '知识库'),
  intro: text('Understand the numbers behind a property.', 'Comprendre les chiffres d’un bien immobilier.', '了解物業數字背後的意義。', '了解物业数字背后的意义。'),
  search: text('Search terms and formulas', 'Rechercher des termes et des formules', '搜尋術語與公式', '搜索术语与公式'),
  language: text('Language', 'Langue', '語言', '语言'),
  category: text('Category', 'Catégorie', '類別', '类别'),
  all: text('All', 'Tout', '全部', '全部'),
  capital: text('Cost of Capital', 'Coût du capital', '資金成本', '资金成本'),
  time: text('Time Value of Money', 'Valeur temporelle de l’argent', '貨幣時間價值', '货币时间价值'),
  cashflow: text('Cash Flow Model', 'Modèle de flux de trésorerie', '現金流模型', '现金流模型'),
  performance: text('Performance', 'Rendement', '績效', '绩效'),
  leverage: text('Leverage', 'Levier financier', '財務槓桿', '财务杠杆'),
  development: text('Development & Construction', 'Développement et construction', '開發與建築', '开发与建设'),
  explanation: text('In plain language', 'En termes simples', '白話解釋', '通俗解释'),
  example: text('Worked example', 'Exemple chiffré', '計算示例', '计算示例'),
  scope: text('Use and limits', 'Utilisation et limites', '用途與限制', '用途与限制'),
  close: text('Close', 'Fermer', '關閉', '关闭'),
  empty: text('No entries match your search.', 'Aucune entrée ne correspond à votre recherche.', '沒有符合搜尋的項目。', '没有符合搜索的条目。'),
  count: text('entries', 'entrées', '個項目', '个条目'),
  clear: text('Clear filters', 'Effacer les filtres', '清除篩選', '清除筛选'),
  pending: text('Library will be available soon.', 'La bibliothèque sera bientôt disponible.', '知識庫即將開放。', '知识库即将开放。'),
  footer: text('Examples explain the math; they are not forecasts or lending decisions.', 'Les exemples expliquent les calculs; ils ne sont ni des prévisions ni des décisions de crédit.', '示例用於說明計算，並非預測或貸款決定。', '示例用于说明计算，并非预测或贷款决定。'),
};
const initialCatalog = [
  {
    id:'F-101', category:'capital', tiers:['COM'], formula:'Total Capital = Equity + Debt', lineage:'Doc 06 F-101; illustrative example',
    name:text('Capital Stack','Structure du capital','資本結構','资本结构'),
    explanation:text('Equity and debt together fund a purchase. Debt normally has repayment priority over equity.','Les fonds propres et la dette financent ensemble l’achat. Le remboursement de la dette a normalement priorité sur les fonds propres.','自有資金與借款共同提供購置資金。債務通常比股權優先獲得償還。','自有资金与借款共同提供购置资金。债务通常比股权优先获得偿还。'),
    example:text('An illustrative purchase uses $300,000 equity and $700,000 debt: total capital is $1,000,000.','Un achat illustratif utilise 300 000 $ de fonds propres et 700 000 $ de dette : le capital total est de 1 000 000 $.','假設以 $300,000 自有資金及 $700,000 借款購置：總資本為 $1,000,000。','假设以 $300,000 自有资金及 $700,000 借款购置：总资本为 $1,000,000。'),
    exampleFormula:'300,000 + 700,000 = 1,000,000',
    scope:text('A capital stack describes funding, not the return earned by each participant.','La structure décrit le financement, pas le rendement de chaque participant.','資本結構描述資金來源，並不代表各方收益。','资本结构描述资金来源，并不代表各方收益。'),
  },
  {
    id:'F-102', category:'capital', tiers:['COM'], formula:'WACC = (D/V × Rd × (1 − Tc)) + (E/V × Re)', lineage:'Doc 06 F-102 original example',
    name:text('Weighted Average Cost of Capital (WACC)','Coût moyen pondéré du capital (WACC)','加權平均資金成本 (WACC)','加权平均资金成本 (WACC)'),
    explanation:text('Blend the debt cost and required equity return using their funding shares. The tax adjustment applies only when the assumed deduction is available.','Combinez le coût de la dette et le rendement exigé des fonds propres selon leur part du financement. L’ajustement fiscal s’applique seulement si la déduction supposée est disponible.','按借款與股權的資金比重，合併借款成本及股權要求回報。稅務調整只適用於假設扣除確實可用的情況。','按借款与股权的资金比重，合并借款成本及股权要求回报。税务调整只适用于假设扣除确实可用的情况。'),
    example:text('Example assumptions: 65% debt at 5.5%, 35% equity requiring 11%, and a 27% tax rate. WACC rounds to 6.46%.','Hypothèses de l’exemple : 65 % de dette à 5,5 %, 35 % de fonds propres exigeant 11 % et un taux d’impôt de 27 %. Le WACC arrondi est de 6,46 %.','示例假設借款佔 65%、利率 5.5%，股權佔 35%、要求回報 11%，稅率 27%。WACC 約為 6.46%。','示例假设借款占 65%、利率 5.5%，股权占 35%、要求回报 11%，税率 27%。WACC 约为 6.46%。'),
    exampleFormula:'0.65 × 0.055 × (1 − 0.27) + 0.35 × 0.11 = 6.45975%',
    scope:text('D and E are debt and equity; V is their total; Rd and Re are their costs; Tc is the assumed tax rate. These are example assumptions.','D et E représentent la dette et les fonds propres; V est leur total; Rd et Re sont leurs coûts; Tc est le taux d’impôt supposé. Ce sont des hypothèses d’exemple.','D、E 為借款與股權；V 為兩者總額；Rd、Re 為其成本；Tc 為假設稅率。數值均為示例假設。','D、E 为借款与股权；V 为两者总额；Rd、Re 为其成本；Tc 为假设税率。数值均为示例假设。'),
  },
  {
    id:'F-202', category:'time', tiers:['RES','COM','DEV'], formula:'FV = PV × (1 + i)^n', lineage:'Doc 06 F-202 original example',
    name:text('Future Value','Valeur future','未來價值','未来价值'),
    explanation:text('Compound today’s amount over n periods at a constant rate i, with returns reinvested.','Capitalisez le montant actuel sur n périodes au taux constant i, en réinvestissant les rendements.','以固定每期利率 i 累積 n 期，並將回報再投入。','以固定每期利率 i 累积 n 期，并将回报再投入。'),
    example:text('$250,000 compounded at 6% annually for 10 years becomes about $447,712.','250 000 $ capitalisés à 6 % par année pendant 10 ans donnent environ 447 712 $.','$250,000 以每年 6% 複利累積 10 年，約為 $447,712。','$250,000 以每年 6% 复利累积 10 年，约为 $447,712。'),
    exampleFormula:'250,000 × 1.06^10 ≈ 447,712',
    scope:text('The rate and period must use the same time unit. A constant rate is an assumption, not a prediction.','Le taux et la période doivent utiliser la même unité de temps. Un taux constant est une hypothèse, pas une prévision.','利率與期數須使用相同時間單位。固定利率是計算假設，而非預測。','利率与期数须使用相同时间单位。固定利率是计算假设，而非预测。'),
  },
  {
    id:'F-204', category:'time', tiers:['RES','COM','DEV'], formula:'PV = FV ÷ (1 + i)^n', lineage:'Doc 06 F-204 original example',
    name:text('Present Value','Valeur actuelle','現值','现值'),
    explanation:text('Discount a future amount to today using an assumed periodic return.','Actualisez un montant futur à aujourd’hui selon un rendement périodique supposé.','以假設每期回報率，將未來金額折算為今天的價值。','以假设每期回报率，将未来金额折算为今天的价值。'),
    example:text('$500,000 received in 7 years, discounted at 8% annually, has a present value of about $291,745.','500 000 $ reçus dans 7 ans et actualisés à 8 % par année ont une valeur actuelle d’environ 291 745 $.','7 年後收取 $500,000，以每年 8% 折現，現值約 $291,745。','7 年后收取 $500,000，以每年 8% 折现，现值约 $291,745。'),
    exampleFormula:'500,000 ÷ 1.08^7 ≈ 291,745',
    scope:text('The discount rate is an assumption. This example covers one payment, not an entire investment.','Le taux d’actualisation est une hypothèse. Cet exemple porte sur un versement, pas sur un investissement entier.','折現率屬於假設。此例只計算一筆款項，而非整項投資。','折现率属于假设。此例只计算一笔款项，而非整项投资。'),
  },
  {
    id:'F-207', category:'time', tiers:['RES','COM'], formula:'Years to double ≈ 72 ÷ annual return (%)', lineage:'Doc 06 F-207 example',
    name:text('Rule of 72','Règle de 72','72 法則','72 法则'),
    explanation:text('A mental shortcut estimates how many years compound growth takes to double an amount.','Ce raccourci mental estime le nombre d’années nécessaires pour doubler un montant avec une croissance composée.','這個心算捷徑可估算複利增長使金額翻倍所需的年數。','这个心算捷径可估算复利增长使金额翻倍所需的年数。'),
    example:text('At an assumed 6% annual return, 72 ÷ 6 gives approximately 12 years.','Avec un rendement annuel supposé de 6 %, 72 ÷ 6 donne environ 12 ans.','假設每年回報 6%，72 ÷ 6 約為 12 年。','假设每年回报 6%，72 ÷ 6 约为 12 年。'),
    exampleFormula:'72 ÷ 6 = 12 (approximation)',
    scope:text('This is an approximation for positive compound growth, not an exact calculation or guaranteed return.','C’est une approximation pour une croissance composée positive, pas un calcul exact ni un rendement garanti.','此法僅為正複利增長的估算，並非精確計算或保證回報。','此法仅为正复利增长的估算，并非精确计算或保证回报。'),
  },
  {
    id:'F-302', category:'cashflow', tiers:['RES','COM','DEV'], formula:'Initial Investment = Purchase Price − Loan Amount + Acquisition Costs', lineage:'Doc 06 F-302; illustrative example',
    name:text('Initial Equity Investment','Mise de fonds initiale totale','初始股權投入','初始股权投入'),
    explanation:text('Include the cash paid at closing: the price less borrowed funds, plus acquisition costs.','Incluez les liquidités versées à la clôture : le prix moins les fonds empruntés, plus les frais d’acquisition.','計入成交時投入的現金：購價扣除借款，再加購置費用。','计入成交时投入的现金：购价扣除借款，再加购置费用。'),
    example:text('Illustrative figures: $1,000,000 price, $700,000 loan and $30,000 acquisition costs require $330,000 cash.','Chiffres illustratifs : un prix de 1 000 000 $, un prêt de 700 000 $ et des frais de 30 000 $ exigent 330 000 $ en liquidités.','假設購價 $1,000,000、借款 $700,000、購置費用 $30,000，所需現金為 $330,000。','假设购价 $1,000,000、借款 $700,000、购置费用 $30,000，所需现金为 $330,000。'),
    exampleFormula:'1,000,000 − 700,000 + 30,000 = 330,000',
    scope:text('Include initial improvements when measuring total cash invested for cash-on-cash return.','Incluez les améliorations initiales dans le total investi utilisé pour le rendement sur mise de fonds.','計算現金回報率所用的總投入現金時，還須計入初期改良支出。','计算现金回报率所用的总投入现金时，还须计入初期改良支出。'),
  },
  {
    id:'F-401', category:'performance', tiers:['RES','COM','DEV'], formula:'NOI = Gross Operating Income − Operating Expenses', lineage:'Doc 06 F-401 original example',
    name:text('Net Operating Income (NOI)','Revenu net d’exploitation (RNE)','淨營運收入 (NOI)','净营运收入 (NOI)'),
    explanation:text('NOI measures annual property operations before financing. Account for vacancy and other income before deducting operating expenses.','Le RNE mesure l’exploitation annuelle avant le financement. Tenez compte de l’inoccupation et des autres revenus avant de déduire les charges d’exploitation.','NOI 衡量融資前的年度物業營運收入。先計入空置及其他收入，再扣除營運費用。','NOI 衡量融资前的年度物业营运收入。先计入空置及其他收入，再扣除营运费用。'),
    example:text('Annual rent $237,600 plus vacancy-affected parking $9,600, less 4% vacancy, plus antenna income $6,000, less expenses $84,000 gives NOI $159,312.','Loyers annuels de 237 600 $ et stationnement de 9 600 $, moins 4 % d’inoccupation, plus 6 000 $ d’antenne, moins 84 000 $ de charges : RNE de 159 312 $.','年度租金 $237,600 加受空置影響的停車收入 $9,600，扣 4% 空置，加天線收入 $6,000，扣費用 $84,000，NOI 為 $159,312。','年度租金 $237,600 加受空置影响的停车收入 $9,600，扣 4% 空置，加天线收入 $6,000，扣费用 $84,000，NOI 为 $159,312。'),
    exampleFormula:'(237,600 + 9,600) × 0.96 + 6,000 − 84,000 = 159,312',
    scope:text('Exclude debt service, depreciation, capital expenditure, owner income taxes and replacement reserves from this operating-expense definition.','Cette définition exclut le service de la dette, l’amortissement, les dépenses en capital, l’impôt sur le revenu du propriétaire et les réserves de remplacement.','此營運費用定義不含還本付息、折舊、資本支出、業主所得稅及重置儲備。','此营运费用定义不含还本付息、折旧、资本支出、业主所得税及重置储备。'),
  },
  {
    id:'F-403', category:'performance', tiers:['RES','COM','DEV'], formula:'CoC = Annual Cash Flow after Debt Service ÷ Total Initial Cash Invested', lineage:'Doc 06 F-403; illustrative example',
    name:text('Cash-on-Cash Return','Rendement sur mise de fonds','現金回報率 (cash-on-cash)','现金回报率 (cash-on-cash)'),
    explanation:text('Compare a year’s cash flow after debt payments with all cash initially invested.','Comparez le flux annuel après les paiements de dette à toutes les liquidités investies au départ.','將償債後的年度現金流與初始投入的全部現金相比。','将偿债后的年度现金流与初始投入的全部现金相比。'),
    example:text('An illustrative $26,400 cash flow on $330,000 total initial cash gives an 8% cash-on-cash return.','Un flux illustratif de 26 400 $ sur une mise initiale totale de 330 000 $ donne un rendement de 8 %.','假設年度現金流 $26,400，初始投入總額 $330,000，現金回報率為 8%。','假设年度现金流 $26,400，初始投入总额 $330,000，现金回报率为 8%。'),
    exampleFormula:'26,400 ÷ 330,000 = 8%',
    scope:text('This is a one-year cash yield. It does not include appreciation, principal paydown or sale proceeds.','Il s’agit d’un rendement de trésorerie sur une année, sans appréciation, remboursement du capital ni produit de vente.','此為一年的現金收益率，不含升值、償還本金或出售所得。','此为一年的现金收益率，不含升值、偿还本金或出售所得。'),
  },
  {
    id:'F-404', category:'performance', tiers:['RES','COM','DEV'], formula:'Cap Rate = NOI ÷ Property Value', lineage:'Doc 06 F-404; F-401 NOI with illustrative value',
    name:text('Capitalization Rate','Taux de capitalisation','資本化率','资本化率'),
    explanation:text('Compare annual NOI with the property’s price or value before considering debt financing.','Comparez le RNE annuel au prix ou à la valeur du bien avant de considérer le financement par dette.','將年度 NOI 與物業購價或價值相比，不計債務融資影響。','将年度 NOI 与物业购价或价值相比，不计债务融资影响。'),
    example:text('Use annual NOI of $159,312 with an illustrative $3,000,000 property value: the cap rate is 5.3104%.','Avec un RNE annuel de 159 312 $ et une valeur illustrative de 3 000 000 $, le taux est de 5,3104 %.','使用年度 NOI $159,312，搭配假設物業價值 $3,000,000，資本化率為 5.3104%。','使用年度 NOI $159,312，搭配假设物业价值 $3,000,000，资本化率为 5.3104%。'),
    exampleFormula:'159,312 ÷ 3,000,000 = 5.3104%',
    scope:text('State the denominator. NOI divided by total asset cost is yield on cost; it is a different measure.','Précisez le dénominateur. Le RNE divisé par le coût total de l’actif est le rendement sur coût, une autre mesure.','須說明分母。NOI 除以資產總成本稱為成本收益率，屬於不同指標。','须说明分母。NOI 除以资产总成本称为成本收益率，属于不同指标。'),
  },
  {
    id:'F-501', category:'leverage', tiers:['RES','COM','DEV'], formula:'LTV = Loan ÷ Property Value', lineage:'Doc 06 F-501; illustrative example',
    name:text('Loan-to-Value (LTV)','Ratio prêt-valeur (RPV)','貸款價值比 (LTV)','贷款价值比 (LTV)'),
    explanation:text('Measure the loan as a share of the stated property value.','Mesurez le prêt en proportion de la valeur indiquée du bien.','衡量借款佔所列物業價值的比例。','衡量借款占所列物业价值的比例。'),
    example:text('An illustrative $700,000 loan against a $1,000,000 property value has an LTV of 70%.','Un prêt illustratif de 700 000 $ sur une valeur de 1 000 000 $ donne un RPV de 70 %.','假設借款 $700,000、物業價值 $1,000,000，LTV 為 70%。','假设借款 $700,000、物业价值 $1,000,000，LTV 为 70%。'),
    exampleFormula:'700,000 ÷ 1,000,000 = 70%',
    scope:text('Value, price and total project cost are different denominators. This ratio does not establish loan eligibility.','Valeur, prix et coût total du projet sont des dénominateurs différents. Ce ratio n’établit pas l’admissibilité au prêt.','價值、購價及項目總成本是不同分母。此比率不能確定貸款資格。','价值、购价及项目总成本是不同分母。此比率不能确定贷款资格。'),
  },
  {
    id:'F-502', category:'leverage', tiers:['COM','DEV'], formula:'DSCR = NOI ÷ Annual Debt Service', lineage:'Doc 06 F-502; F-401 NOI with illustrative debt service',
    name:text('Debt Service Coverage Ratio (DSCR)','Ratio de couverture du service de la dette (RCSD)','償債覆蓋率 (DSCR)','偿债备付率 (DSCR)'),
    explanation:text('For an income property, compare annual NOI with annual principal and interest payments.','Pour un immeuble à revenus, comparez le RNE annuel aux paiements annuels de capital et d’intérêts.','對收益物業，將年度 NOI 與年度本金及利息付款相比。','对收益物业，将年度 NOI 与年度本金及利息付款相比。'),
    example:text('Annual NOI of $159,312 divided by illustrative annual debt service of $120,000 gives a DSCR of 1.3276.','Le RNE annuel de 159 312 $ divisé par un service annuel illustratif de 120 000 $ donne un RCSD de 1,3276.','年度 NOI $159,312 除以假設年度還本付息 $120,000，DSCR 為 1.3276。','年度 NOI $159,312 除以假设年度还本付息 $120,000，DSCR 为 1.3276。'),
    exampleFormula:'159,312 ÷ 120,000 = 1.3276',
    scope:text('A ratio of 1 means equal income and debt service. Definitions and required thresholds depend on the lender and loan.','Un ratio de 1 signifie que le revenu égale le service de la dette. Définitions et seuils exigés dépendent du prêteur et du prêt.','比率為 1 表示收入等於還本付息金額。定義與要求門檻依貸款及貸款機構而定。','比率为 1 表示收入等于还本付息金额。定义与要求门槛依贷款及贷款机构而定。'),
  },
  {
    id:'F-707', category:'development', tiers:['DEV'], formula:'Profit = Effective Gross Revenue − Total Development Budget; ROC = Profit ÷ Total Development Budget', lineage:'Doc 06 Addendum A F-707 reported Gilley figures; arithmetic rechecked',
    name:text('Return on Cost (ROC)','Rendement sur coût (ROC)','成本回報率 (ROC)','成本回报率 (ROC)'),
    explanation:text('Compare development profit with the total development budget. It is a project return, without annualizing time.','Comparez le bénéfice de développement au budget total. C’est un rendement de projet, sans annualisation de la durée.','將開發利潤與開發總預算相比。此為項目回報，未按時間年化。','将开发利润与开发总预算相比。此为项目回报，未按时间年化。'),
    example:text('Historical Gilley project figures: $56,371,262 revenue less $43,751,237 budget gives $12,620,025 profit and about 28.84% ROC.','Chiffres historiques du projet Gilley : revenus de 56 371 262 $ moins budget de 43 751 237 $ = bénéfice de 12 620 025 $ et ROC d’environ 28,84 %.','Gilley 的歷史項目數字：收入 $56,371,262 扣預算 $43,751,237，利潤為 $12,620,025，ROC 約為 28.84%。','Gilley 的历史项目数字：收入 $56,371,262 扣预算 $43,751,237，利润为 $12,620,025，ROC 约为 28.84%。'),
    exampleFormula:'56,371,262 − 43,751,237 = 12,620,025; 12,620,025 ÷ 43,751,237 ≈ 28.84%',
    scope:text('This is not IRR or an annual yield. These are historical documented project figures, not a current project forecast.','Ce n’est ni un TRI ni un rendement annuel. Ce sont des chiffres de projet historiques documentés, pas une prévision actuelle.','此指標並非 IRR 或年度收益率。數字為已記錄的歷史項目資料，而非現時項目預測。','此指标并非 IRR 或年度收益率。数字为已记录的历史项目资料，而非现时项目预测。'),
  },
];
export const catalog = [...initialCatalog, ...remainingCatalog].sort((a,b)=>a.id.localeCompare(b.id));

export function normalizeLocale(value) { return locales.includes(value) ? value : 'en'; }
export function translate(value, locale) { return value[normalizeLocale(locale)]; }
export function filterCatalog(query='', category='all', locale='en') {
  const normalized = String(query ?? '').normalize('NFKC').toLocaleLowerCase(normalizeLocale(locale)).trim().slice(0,200);
  return catalog.filter(item => (category === 'all' || item.category === category) &&
    (!normalized || [item.id, item.formula, ...item.tiers, ...Object.values(item.name), ...Object.values(item.explanation)]
      .some(value => value.normalize('NFKC').toLocaleLowerCase(normalizeLocale(locale)).includes(normalized))));
}
