// Original educational copy; source conventions are pinned in docs/review/library/statistics-inventory.json.
export const statisticsCatalog = [
  {
    "id": "S-001",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Mean = Σ xᵢ ÷ n",
    "exampleFormula": "(1,000 + 1,200 + 1,800) ÷ 3 ≈ 1,333.33",
    "name": {
      "en": "Arithmetic Mean",
      "fr-CA": "Moyenne arithmétique",
      "zh-Hant": "算術平均數",
      "zh-Hans": "算术平均数"
    },
    "explanation": {
      "en": "Add comparable observations and divide by their count. Each observation has equal weight.",
      "fr-CA": "Additionnez des observations comparables, puis divisez par leur nombre. Chaque observation a le même poids.",
      "zh-Hant": "將可比較的觀測值相加，再除以數量。每個觀測值的權重相同。",
      "zh-Hans": "将可比较的观测值相加，再除以数量。每个观测值的权重相同。"
    },
    "example": {
      "en": "Illustrative monthly rents of $1,000, $1,200 and $1,800 have a mean of about $1,333.33. These are synthetic figures.",
      "fr-CA": "Des loyers mensuels fictifs de 1 000 $, 1 200 $ et 1 800 $ donnent une moyenne d’environ 1 333,33 $.",
      "zh-Hant": "假設月租為 $1,000、$1,200 及 $1,800，平均約為 $1,333.33。數字為示例。",
      "zh-Hans": "假设月租为 $1,000、$1,200 及 $1,800，平均约为 $1,333.33。数字为示例。"
    },
    "scope": {
      "en": "Use consistent units and periods. Large outliers can shift the mean; an empty set has no mean. This is not a current market rent estimate.",
      "fr-CA": "Gardez les mêmes unités et périodes. Les valeurs extrêmes peuvent déplacer la moyenne; un ensemble vide n’a pas de moyenne. Ce n’est pas une estimation du loyer actuel.",
      "zh-Hant": "單位及期間須一致。極端值可拉高或拉低平均數；空資料集沒有平均數。此非現時市場租金估算。",
      "zh-Hans": "单位及期间须一致。极端值可拉高或拉低平均数；空数据集没有平均数。此非现时市场租金估算。"
    },
    "relatedIds": [
      "S-002",
      "S-003"
    ],
    "lineage": "Library topic ST01; statistical-risk/descriptive.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-002",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Median = middle sorted value; even n: average of the two middle values",
    "exampleFormula": "[1,000, 1,200, 1,400, 1,600] → (1,200 + 1,400) ÷ 2 = 1,300",
    "name": {
      "en": "Median",
      "fr-CA": "Médiane",
      "zh-Hant": "中位數",
      "zh-Hans": "中位数"
    },
    "explanation": {
      "en": "Sort the values and locate the middle. With an even count, average the two middle values.",
      "fr-CA": "Triez les valeurs et repérez le milieu. Pour un nombre pair, faites la moyenne des deux valeurs centrales.",
      "zh-Hant": "將數值排序，取中間的數值；數量為偶數時，取中間兩數的平均。",
      "zh-Hans": "将数值排序，取中间的数值；数量为偶数时，取中间两数的平均。"
    },
    "example": {
      "en": "Four synthetic monthly rents of $1,000, $1,200, $1,400 and $1,600 have a median of $1,300.",
      "fr-CA": "Quatre loyers mensuels fictifs de 1 000 $, 1 200 $, 1 400 $ et 1 600 $ ont une médiane de 1 300 $.",
      "zh-Hant": "四個假設月租 $1,000、$1,200、$1,400、$1,600 的中位數為 $1,300。",
      "zh-Hans": "四个假设月租 $1,000、$1,200、$1,400、$1,600 的中位数为 $1,300。"
    },
    "scope": {
      "en": "The median describes the observed middle, not every property or future value. Keep observations comparable; an empty set has no median.",
      "fr-CA": "La médiane décrit le milieu observé, pas chaque bien ni sa valeur future. Les observations doivent être comparables; un ensemble vide n’a pas de médiane.",
      "zh-Hant": "中位數描述資料的中間位置，並非每個物業的租金或未來價值。資料須可比較；空資料集沒有中位數。",
      "zh-Hans": "中位数描述数据的中间位置，并非每个物业的租金或未来价值。数据须可比较；空数据集没有中位数。"
    },
    "relatedIds": [
      "S-001",
      "S-005"
    ],
    "lineage": "Library topic ST02; statistical-risk/descriptive.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-003",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Weighted Mean = Σ (wᵢ × xᵢ) ÷ Σ wᵢ",
    "exampleFormula": "(2 × 1,000 + 1 × 1,500) ÷ (2 + 1) ≈ 1,166.67",
    "name": {
      "en": "Weighted Mean",
      "fr-CA": "Moyenne pondérée",
      "zh-Hant": "加權平均數",
      "zh-Hans": "加权平均数"
    },
    "explanation": {
      "en": "Give each observation an explicit weight, multiply value by weight, then divide their sum by total weight.",
      "fr-CA": "Attribuez un poids explicite à chaque observation, multipliez valeur et poids, puis divisez leur somme par le poids total.",
      "zh-Hant": "為每個觀測值設定明確權重，將數值乘權重後相加，再除以總權重。",
      "zh-Hans": "为每个观测值设定明确权重，将数值乘权重后相加，再除以总权重。"
    },
    "example": {
      "en": "Two illustrative units renting at $1,000 and one at $1,500 give a unit-weighted mean rent of about $1,166.67.",
      "fr-CA": "Deux logements fictifs à 1 000 $ et un à 1 500 $ donnent un loyer moyen pondéré par logement d’environ 1 166,67 $.",
      "zh-Hant": "假設兩個單位月租各 $1,000，另一個為 $1,500，按單位數加權的平均月租約為 $1,166.67。",
      "zh-Hans": "假设两个单位月租各 $1,000，另一个为 $1,500，按单位数加权的平均月租约为 $1,166.67。"
    },
    "scope": {
      "en": "Weights must match the values, be non-negative and total more than zero in this example. Weight choice changes the answer; it does not prove data quality.",
      "fr-CA": "Les poids doivent correspondre aux valeurs, être non négatifs et totaliser plus de zéro dans cet exemple. Leur choix change le résultat et ne prouve pas la qualité des données.",
      "zh-Hant": "本示例的權重須與數值對應、非負且總和大於零。權重選擇會改變結果，不能證明資料品質。",
      "zh-Hans": "本示例的权重须与数值对应、非负且总和大于零。权重选择会改变结果，不能证明数据质量。"
    },
    "relatedIds": [
      "S-001"
    ],
    "lineage": "Library topic ST03; statistical-risk/weighted.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-004",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Range = Maximum − Minimum",
    "exampleFormula": "Min = 1,000; Max = 1,800; Range = 1,800 − 1,000 = 800",
    "name": {
      "en": "Minimum, Maximum and Range",
      "fr-CA": "Minimum, maximum et étendue",
      "zh-Hant": "最小值、最大值與全距",
      "zh-Hans": "最小值、最大值与极差"
    },
    "explanation": {
      "en": "The smallest and largest observations set the observed limits. Their difference is the range.",
      "fr-CA": "Les observations minimale et maximale fixent les limites observées. Leur différence est l’étendue.",
      "zh-Hant": "最小及最大觀測值界定資料的觀測範圍；兩者之差為全距。",
      "zh-Hans": "最小及最大观测值界定数据的观测范围；两者之差为极差。"
    },
    "example": {
      "en": "Synthetic monthly rents of $1,000, $1,200 and $1,800 have a minimum of $1,000, maximum of $1,800 and range of $800.",
      "fr-CA": "Des loyers mensuels fictifs de 1 000 $, 1 200 $ et 1 800 $ ont un minimum de 1 000 $, un maximum de 1 800 $ et une étendue de 800 $.",
      "zh-Hant": "假設月租 $1,000、$1,200、$1,800，最小值為 $1,000，最大值為 $1,800，全距為 $800。",
      "zh-Hans": "假设月租 $1,000、$1,200、$1,800，最小值为 $1,000，最大值为 $1,800，极差为 $800。"
    },
    "scope": {
      "en": "The range depends on extremes and sample size. It is not a forecast interval or evidence that future observations stay inside it. Empty input has no observed limits.",
      "fr-CA": "L’étendue dépend des extrêmes et de la taille de l’échantillon. Ce n’est pas un intervalle de prévision ni une garantie pour les valeurs futures. Sans données, aucune limite n’est observée.",
      "zh-Hant": "全距受極端值及樣本量影響，並非預測區間，也不保證未來數值在其中。沒有資料便沒有觀測上下限。",
      "zh-Hans": "极差受极端值及样本量影响，并非预测区间，也不保证未来数值在其中。没有数据便没有观测上下限。"
    },
    "relatedIds": [
      "S-005",
      "S-007"
    ],
    "lineage": "Library topic ST04; statistical-risk/descriptive.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-005",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "R-7: h = (n − 1) × p; Q(p) = x⌊h⌋ + (h − ⌊h⌋) × (x⌈h⌉ − x⌊h⌋); sorted, zero-based indices",
    "exampleFormula": "[1,000, 1,200, 1,400, 1,600] → Q1 = 1,150; Q2 = 1,300; Q3 = 1,450",
    "name": {
      "en": "Quantiles, Quartiles and Percentiles",
      "fr-CA": "Quantiles, quartiles et percentiles",
      "zh-Hant": "分位數、四分位數與百分位數",
      "zh-Hans": "分位数、四分位数与百分位数"
    },
    "explanation": {
      "en": "A quantile locates a position in sorted data. Quartiles use p = 0.25, 0.50 and 0.75. This example uses R-7 linear interpolation between neighbouring values.",
      "fr-CA": "Un quantile situe une position dans les données triées. Les quartiles utilisent p = 0,25, 0,50 et 0,75. Cet exemple interpole linéairement entre valeurs voisines selon R-7.",
      "zh-Hant": "分位數表示排序資料中的位置。四分位數使用 p = 0.25、0.50、0.75。本示例採用 R-7，在相鄰數值間線性插值。",
      "zh-Hans": "分位数表示排序数据中的位置。四分位数使用 p = 0.25、0.50、0.75。本示例采用 R-7，在相邻数值间线性插值。"
    },
    "example": {
      "en": "For synthetic rents $1,000, $1,200, $1,400 and $1,600, R-7 gives Q1 = $1,150, median Q2 = $1,300 and Q3 = $1,450.",
      "fr-CA": "Pour des loyers fictifs de 1 000 $, 1 200 $, 1 400 $ et 1 600 $, R-7 donne Q1 = 1 150 $, Q2 = 1 300 $ et Q3 = 1 450 $.",
      "zh-Hant": "假設租金 $1,000、$1,200、$1,400、$1,600，R-7 得出 Q1 = $1,150、中位數 Q2 = $1,300、Q3 = $1,450。",
      "zh-Hans": "假设租金 $1,000、$1,200、$1,400、$1,600，R-7 得出 Q1 = $1,150、中位数 Q2 = $1,300、Q3 = $1,450。"
    },
    "scope": {
      "en": "Use p between 0 and 1 and non-empty data. Other percentile conventions can differ, especially in small samples. A percentile value is distinct from percentile rank.",
      "fr-CA": "Utilisez p entre 0 et 1 et des données non vides. D’autres conventions peuvent différer, surtout dans les petits échantillons. La valeur d’un percentile diffère du rang percentile.",
      "zh-Hant": "p 須在 0 至 1 之間，且資料不可為空。不同百分位算法可能得出不同結果，尤其在小樣本。百分位數值與百分位排名不同。",
      "zh-Hans": "p 须在 0 至 1 之间，且数据不可为空。不同百分位算法可能得出不同结果，尤其在小样本。百分位数值与百分位排名不同。"
    },
    "relatedIds": [
      "S-002",
      "S-006"
    ],
    "lineage": "Library topic ST05; statistical-risk/descriptive.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-006",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Mid-rank (%) = (Count below + 0.5 × Count equal) ÷ n × 100",
    "exampleFormula": "[1,000, 1,200, 1,200, 1,600], x = 1,200 → (1 + 0.5 × 2) ÷ 4 × 100 = 50%",
    "name": {
      "en": "Percentile Rank",
      "fr-CA": "Rang percentile",
      "zh-Hant": "百分位排名",
      "zh-Hans": "百分位排名"
    },
    "explanation": {
      "en": "Locate a value relative to a reference set. This mid-rank convention counts values below it and half of those tied with it.",
      "fr-CA": "Situez une valeur dans un ensemble de référence. Cette convention de rang moyen compte les valeurs inférieures et la moitié des valeurs égales.",
      "zh-Hant": "將某數值與參考資料集比較。本中間排名慣例計算較低數值的數量，並加上相同數值數量的一半。",
      "zh-Hans": "将某数值与参考数据集比较。本中间排名惯例计算较低数值的数量，并加上相同数值数量的一半。"
    },
    "example": {
      "en": "In synthetic rents $1,000, $1,200, $1,200 and $1,600, a rent of $1,200 has one value below and two equal, giving a mid-rank of 50%.",
      "fr-CA": "Dans les loyers fictifs 1 000 $, 1 200 $, 1 200 $ et 1 600 $, un loyer de 1 200 $ a une valeur inférieure et deux égales, soit un rang moyen de 50 %.",
      "zh-Hant": "假設租金為 $1,000、$1,200、$1,200、$1,600；$1,200 有一個數值較低、兩個相同，中間百分位排名為 50%。",
      "zh-Hans": "假设租金为 $1,000、$1,200、$1,200、$1,600；$1,200 有一个数值较低、两个相同，中间百分位排名为 50%。"
    },
    "scope": {
      "en": "Tie conventions vary. An empty reference set has no rank. Multiply the mid-rank fraction by 100 to display a percentage, not a percentile rent amount.",
      "fr-CA": "Les conventions d’égalité varient. Un ensemble vide n’a pas de rang. Multipliez la fraction du rang moyen par 100 pour afficher un pourcentage, pas un montant de loyer.",
      "zh-Hant": "同值處理慣例可不同。空參考資料集沒有排名。將中間排名比例乘以 100 顯示百分比，而非某百分位的租金金額。",
      "zh-Hans": "同值处理惯例可不同。空参考数据集没有排名。将中间排名比例乘以 100 显示百分比，而非某百分位的租金金额。"
    },
    "relatedIds": [
      "S-005"
    ],
    "lineage": "Library topic ST06; statistical-risk/descriptive.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-007",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Sample variance s² = Σ (xᵢ − mean)² ÷ (n − 1); s = √s²; population: divide by n",
    "exampleFormula": "[1,000, 1,200, 1,400] → mean = 1,200; Σ deviations² = 80,000; s² = 40,000; s = 200; population SD ≈ 163.30",
    "name": {
      "en": "Variance and Standard Deviation",
      "fr-CA": "Variance et écart-type",
      "zh-Hant": "變異數與標準差",
      "zh-Hans": "方差与标准差"
    },
    "explanation": {
      "en": "Variance averages squared distances from the mean. Standard deviation takes its square root and returns to the original units. A sample uses n − 1; a complete population uses n.",
      "fr-CA": "La variance résume les écarts au carré à la moyenne. L’écart-type en prend la racine et retrouve les unités initiales. Un échantillon utilise n − 1; une population complète utilise n.",
      "zh-Hant": "變異數以與平均數的差距平方衡量離散程度；標準差取平方根，回到原單位。樣本除以 n − 1；完整母體除以 n。",
      "zh-Hans": "方差以与平均数的差距平方衡量离散程度；标准差取平方根，回到原单位。样本除以 n − 1；完整总体除以 n。"
    },
    "example": {
      "en": "Synthetic rents $1,000, $1,200 and $1,400 have mean $1,200 and squared deviations totalling 80,000. Sample variance is 40,000 and sample SD is $200; population SD is about $163.30.",
      "fr-CA": "Les loyers fictifs 1 000 $, 1 200 $ et 1 400 $ ont une moyenne de 1 200 $ et une somme d’écarts au carré de 80 000. La variance d’échantillon est 40 000 et son écart-type 200 $; l’écart-type de population vaut environ 163,30 $.",
      "zh-Hant": "假設租金 $1,000、$1,200、$1,400，平均 $1,200，差距平方和為 80,000。樣本變異數為 40,000，樣本標準差為 $200；母體標準差約 $163.30。",
      "zh-Hans": "假设租金 $1,000、$1,200、$1,400，平均 $1,200，差距平方和为 80,000。样本方差为 40,000，样本标准差为 $200；总体标准差约 $163.30。"
    },
    "scope": {
      "en": "Sample statistics require at least two observations. Population statistics need at least one. Variance has squared units. Dispersion is not a confidence interval or forecast accuracy.",
      "fr-CA": "Les statistiques d’échantillon exigent au moins deux observations; celles d’une population, au moins une. La variance a des unités au carré. La dispersion n’est ni un intervalle de confiance ni la précision d’une prévision.",
      "zh-Hant": "樣本統計至少需兩個觀測值；母體統計至少需一個。變異數的單位為平方。離散程度並非信賴區間或預測準確度。",
      "zh-Hans": "样本统计至少需两个观测值；总体统计至少需一个。方差的单位为平方。离散程度并非置信区间或预测准确度。"
    },
    "relatedIds": [
      "S-001",
      "S-008"
    ],
    "lineage": "Library topic ST07; statistical-risk/dispersion.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-008",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "CV = Sample SD ÷ |Mean|; CV (%) = CV × 100",
    "exampleFormula": "[1,000, 1,200, 1,400] → 200 ÷ 1,200 × 100 ≈ 16.67%",
    "name": {
      "en": "Coefficient of Variation",
      "fr-CA": "Coefficient de variation",
      "zh-Hant": "變異係數",
      "zh-Hans": "变异系数"
    },
    "explanation": {
      "en": "Compare sample dispersion with the size of the mean. The displayed convention divides sample standard deviation by the absolute mean.",
      "fr-CA": "Comparez la dispersion d’échantillon à la grandeur de la moyenne. La convention affichée divise l’écart-type d’échantillon par la valeur absolue de la moyenne.",
      "zh-Hant": "將樣本離散程度與平均數大小相比。本卡所示慣例以樣本標準差除以平均數的絕對值。",
      "zh-Hans": "将样本离散程度与平均数大小相比。本卡所示惯例以样本标准差除以平均数的绝对值。"
    },
    "example": {
      "en": "For synthetic rents $1,000, $1,200 and $1,400, sample SD is $200 and mean rent is $1,200. Their CV is about 16.67%.",
      "fr-CA": "Pour les loyers fictifs 1 000 $, 1 200 $ et 1 400 $, l’écart-type d’échantillon est 200 $ et la moyenne 1 200 $. Le coefficient vaut environ 16,67 %.",
      "zh-Hant": "假設租金 $1,000、$1,200、$1,400，樣本標準差 $200、平均 $1,200，變異係數約 16.67%。",
      "zh-Hans": "假设租金 $1,000、$1,200、$1,400，样本标准差 $200、平均 $1,200，变异系数约 16.67%。"
    },
    "scope": {
      "en": "Prefer positive ratio-scale quantities with meaningful zero, such as comparable rents. A zero/near-zero mean makes the ratio unsuitable. Absolute-mean handling is a convention, not a cure for mixed-sign returns or a forecast probability.",
      "fr-CA": "Privilégiez des quantités positives avec un zéro significatif, comme des loyers comparables. Une moyenne nulle ou proche de zéro rend le ratio inadapté. La valeur absolue est une convention, pas une solution aux rendements de signes mixtes ni une probabilité de prévision.",
      "zh-Hant": "宜用於具有真實零點的正值量，例如可比較租金。平均數為零或接近零時不宜使用。絕對值為計算慣例，不能解決正負回報混合，也非預測機率。",
      "zh-Hans": "宜用于具有真实零点的正值量，例如可比较租金。平均数为零或接近零时不宜使用。绝对值为计算惯例，不能解决正负回报混合，也非预测概率。"
    },
    "relatedIds": [
      "S-007"
    ],
    "lineage": "Library topic ST08; statistical-risk/dispersion.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-009",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Change (%) = (Current − Prior) ÷ |Prior| × 100",
    "exampleFormula": "(1,100 − 1,000) ÷ 1,000 × 100 = 10%",
    "name": {
      "en": "Period-over-Period Change",
      "fr-CA": "Variation d’une période à l’autre",
      "zh-Hant": "期間變動率",
      "zh-Hans": "期间变动率"
    },
    "explanation": {
      "en": "Compare two observations of the same measure. Month-over-month, quarter-over-quarter and year-over-year describe the chosen periods, using the same formula.",
      "fr-CA": "Comparez deux observations de la même mesure. Les variations mensuelle, trimestrielle et annuelle décrivent les périodes choisies et utilisent la même formule.",
      "zh-Hant": "比較同一指標的兩個觀測值。按月、按季及按年變動描述所選期間，使用同一公式。",
      "zh-Hans": "比较同一指标的两个观测值。环比月度、季度及同比年度变动描述所选期间，使用同一公式。"
    },
    "example": {
      "en": "An illustrative monthly rent rising from $1,000 to $1,100 changes by 10%. This is a synthetic comparison.",
      "fr-CA": "Un loyer mensuel fictif passant de 1 000 $ à 1 100 $ augmente de 10 %.",
      "zh-Hant": "假設月租由 $1,000 升至 $1,100，變動為 10%。此為示例比較。",
      "zh-Hans": "假设月租由 $1,000 升至 $1,100，变动为 10%。此为示例比较。"
    },
    "scope": {
      "en": "A zero prior value has no percentage change. Keep units, definitions and intervals aligned. This convention divides by |prior|; a negative prior gives signed change relative to its magnitude, which differs from dividing by the signed prior.",
      "fr-CA": "Une valeur antérieure nulle ne permet pas de calculer un pourcentage. Alignez unités, définitions et intervalles. Cette convention divise par |valeur antérieure|; avec une valeur négative, elle mesure la variation signée par rapport à sa grandeur, ce qui diffère d’une division par la valeur signée.",
      "zh-Hant": "前值為零時無法計算百分比。單位、定義及期間須一致。本慣例除以前值的絕對值；前值為負時，表示相對其大小的帶方向變動，與除以帶符號前值不同。",
      "zh-Hans": "前值为零时无法计算百分比。单位、定义及期间须一致。本惯例除以前值的绝对值；前值为负时，表示相对其大小的带方向变动，与除以带符号前值不同。"
    },
    "relatedIds": [
      "S-010",
      "S-011"
    ],
    "lineage": "Library topic ST09; statistical-risk/growth.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-010",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "CAGR = (Ending ÷ Beginning)^(1 ÷ Years) − 1",
    "exampleFormula": "(121 ÷ 100)^(1 ÷ 2) − 1 = 0.10 = 10%",
    "name": {
      "en": "Compound Annual Growth Rate (CAGR)",
      "fr-CA": "Taux de croissance annuel composé (TCAC)",
      "zh-Hant": "複合年增長率 (CAGR)",
      "zh-Hans": "复合年增长率 (CAGR)"
    },
    "explanation": {
      "en": "Express the change between a beginning and ending value as a constant annual compounded rate. It does not describe each intervening year.",
      "fr-CA": "Exprimez le changement entre début et fin comme un taux annuel composé constant. Il ne décrit pas chaque année intermédiaire.",
      "zh-Hant": "將起點與終點之間的變化表示為固定的年度複合增長率，並不描述中間每年的變化。",
      "zh-Hans": "将起点与终点之间的变化表示为固定的年度复合增长率，并不描述中间每年的变化。"
    },
    "example": {
      "en": "A synthetic index rising from 100 to 121 over two years has a CAGR of 10%. Uneven yearly changes could produce the same endpoints.",
      "fr-CA": "Un indice fictif passant de 100 à 121 en deux ans a un TCAC de 10 %. Des variations annuelles irrégulières peuvent donner les mêmes points de départ et d’arrivée.",
      "zh-Hant": "假設指數兩年由 100 升至 121，CAGR 為 10%。即使每年變動不均，也可得出相同起點及終點。",
      "zh-Hans": "假设指数两年由 100 升至 121，CAGR 为 10%。即使每年变动不均，也可得出相同起点及终点。"
    },
    "scope": {
      "en": "Require beginning > 0, ending ≥ 0 and years > 0 for this convention; ending zero produces −100%. CAGR ignores intermediate cash flows and volatility, so it is not IRR or a forecast.",
      "fr-CA": "Cette convention exige début > 0, fin ≥ 0 et durée > 0; une fin nulle donne −100 %. Le TCAC ignore les flux intermédiaires et la volatilité; ce n’est ni un TRI ni une prévision.",
      "zh-Hant": "本慣例要求起值 > 0、終值 ≥ 0、年數 > 0；終值為零得出 −100%。CAGR 忽略中間現金流及波動，並非 IRR 或預測。",
      "zh-Hans": "本惯例要求起值 > 0、终值 ≥ 0、年数 > 0；终值为零得出 −100%。CAGR 忽略中间现金流及波动，并非 IRR 或预测。"
    },
    "relatedIds": [
      "F-202",
      "F-409",
      "S-009"
    ],
    "lineage": "Library topic ST10; statistical-risk/growth.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-011",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Rolling Meanₜ = Σ last k values ÷ k; Rolling Growthₜ = (xₜ − xₜ₋ₖ) ÷ |xₜ₋ₖ|",
    "exampleFormula": "[100, 110, 120, 130], k = 3 → means [—, —, 110, 120]; lag-3 growth [—, —, —, 30%]",
    "name": {
      "en": "Rolling Averages and Rolling Growth",
      "fr-CA": "Moyennes mobiles et croissance glissante",
      "zh-Hant": "移動平均與滾動增長",
      "zh-Hans": "移动平均与滚动增长"
    },
    "explanation": {
      "en": "A rolling mean averages a full window of recent values. Rolling growth compares the current value with the value k periods earlier; these use different starting positions.",
      "fr-CA": "Une moyenne mobile résume une fenêtre complète de valeurs récentes. La croissance glissante compare la valeur actuelle à celle d’il y a k périodes; les positions de départ diffèrent.",
      "zh-Hant": "移動平均取最近一個完整視窗的平均；滾動增長與 k 期前的數值比較，兩者開始提供結果的位置不同。",
      "zh-Hans": "移动平均取最近一个完整窗口的平均；滚动增长与 k 期前的数值比较，两者开始提供结果的位置不同。"
    },
    "example": {
      "en": "For synthetic monthly levels 100, 110, 120 and 130, a three-value mean gives 110 then 120. Growth against three months earlier appears only at month four: (130 − 100) ÷ 100 = 30%.",
      "fr-CA": "Pour les niveaux mensuels fictifs 100, 110, 120 et 130, la moyenne de trois valeurs donne 110 puis 120. La croissance sur trois mois n’apparaît qu’au quatrième mois : (130 − 100) ÷ 100 = 30 %.",
      "zh-Hant": "假設月度數值為 100、110、120、130，三值平均先為 110，再為 120。與三個月前比較的增長僅在第四月出現：(130 − 100) ÷ 100 = 30%。",
      "zh-Hans": "假设月度数值为 100、110、120、130，三值平均先为 110，再为 120。与三个月前比较的增长仅在第四月出现：(130 − 100) ÷ 100 = 30%。"
    },
    "scope": {
      "en": "Choose a positive whole-number window and ordered, equally spaced periods. Insufficient windows stay unavailable, not zero or a shorter average. Growth from zero is unavailable. Smoothing is not a forecast.",
      "fr-CA": "Choisissez une fenêtre entière positive et des périodes ordonnées, régulièrement espacées. Les fenêtres incomplètes restent indisponibles, pas nulles ni raccourcies. La croissance depuis zéro est indisponible. Le lissage n’est pas une prévision.",
      "zh-Hant": "視窗須為正整數，期間須按序且等距。資料不足的視窗保持未提供，而非填零或縮短平均期間。前值為零時不提供增長。平滑並非預測。",
      "zh-Hans": "窗口须为正整数，期间须按序且等距。数据不足的窗口保持未提供，而非填零或缩短平均期间。前值为零时不提供增长。平滑并非预测。"
    },
    "relatedIds": [
      "S-001",
      "S-009"
    ],
    "lineage": "Library topic ST11; statistical-risk/growth.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  },
  {
    "id": "S-012",
    "category": "statistics",
    "tiers": [
      "RES",
      "COM",
      "DEV"
    ],
    "formula": "Indexₜ = Valueₜ ÷ Base Value × 100",
    "exampleFormula": "[1,000, 1,100, 900] ÷ 1,000 × 100 → [100, 110, 90]",
    "name": {
      "en": "Indexed Series: Base 100",
      "fr-CA": "Série indicielle : base 100",
      "zh-Hant": "基期為 100 的指數序列",
      "zh-Hans": "基期为 100 的指数序列"
    },
    "explanation": {
      "en": "Rebase values so the chosen reference value equals 100. This makes relative movement visible while removing the original monetary scale.",
      "fr-CA": "Ramenez les valeurs à une base où la référence vaut 100. Le mouvement relatif devient visible sans l’échelle monétaire initiale.",
      "zh-Hant": "將所選基準數值設為 100，以顯示相對變化，並移除原來的金額尺度。",
      "zh-Hans": "将所选基准数值设为 100，以显示相对变化，并移除原来的金额尺度。"
    },
    "example": {
      "en": "Synthetic monthly rents $1,000, $1,100 and $900, using $1,000 as the base, become index levels 100, 110 and 90. They represent +10% and −10% relative to the base.",
      "fr-CA": "Les loyers mensuels fictifs 1 000 $, 1 100 $ et 900 $, avec 1 000 $ comme base, deviennent 100, 110 et 90 : +10 % et −10 % par rapport à la base.",
      "zh-Hant": "假設月租 $1,000、$1,100、$900，以 $1,000 為基準，指數為 100、110、90，分別較基期 +10% 及 −10%。",
      "zh-Hans": "假设月租 $1,000、$1,100、$900，以 $1,000 为基准，指数为 100、110、90，分别较基期 +10% 及 −10%。"
    },
    "scope": {
      "en": "Use comparable values and an explicit non-zero base; positive rent series use a positive base. An index is dimensionless, not dollars. Missing observations stay missing; rebasing cannot repair incomparable data.",
      "fr-CA": "Utilisez des valeurs comparables et une base explicite non nulle; les loyers positifs utilisent une base positive. Un indice est sans unité monétaire. Les données manquantes restent manquantes; le changement de base ne rend pas des données comparables.",
      "zh-Hant": "數值須可比較，且基準明確、非零；正值租金序列採用正值基準。指數沒有貨幣單位。缺失資料仍為缺失；重設基期不能修正不可比較的資料。",
      "zh-Hans": "数值须可比较，且基准明确、非零；正值租金序列采用正值基准。指数没有货币单位。缺失数据仍为缺失；重设基期不能修正不可比较的数据。"
    },
    "relatedIds": [
      "S-009",
      "S-010"
    ],
    "lineage": "Library topic ST12; statistical-risk/growth.ts at b279e22d71019009439803d928aeadf7e6b92ddc; original synthetic example"
  }
];
