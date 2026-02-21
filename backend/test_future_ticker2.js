function getFutureTickerInfo(baseSymbol, monthsAhead) {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + monthsAhead);
    
    const year = targetDate.getFullYear().toString().slice(-2);
    const month = targetDate.getMonth() + 1; // 1-12

    let validMonths = baseSymbol === 'ZS' 
        ? [
            {m: 1, c: 'F', n: 'Jan'}, {m: 3, c: 'H', n: 'Mar'}, {m: 5, c: 'K', n: 'Mai'}, 
            {m: 7, c: 'N', n: 'Jul'}, {m: 8, c: 'Q', n: 'Ago'}, {m: 9, c: 'U', n: 'Set'}, 
            {m: 11, c: 'X', n: 'Nov'}
          ]
        : [
            {m: 1, c: 'F', n: 'Jan'}, {m: 3, c: 'H', n: 'Mar'}, {m: 5, c: 'K', n: 'Mai'}, 
            {m: 7, c: 'N', n: 'Jul'}, {m: 8, c: 'Q', n: 'Ago'}, {m: 9, c: 'U', n: 'Set'}, 
            {m: 10, c: 'V', n: 'Out'}, {m: 12, c: 'Z', n: 'Dez'}
          ];

    let futureMonth = validMonths.find(v => v.m >= month);
    let finalYear = year;
    if (!futureMonth) {
        futureMonth = validMonths[0];
        finalYear = (targetDate.getFullYear() + 1).toString().slice(-2);
    }

    return {
        ticker: `${baseSymbol}${futureMonth.c}${finalYear}.CBT`,
        name: futureMonth.n
    };
}
console.log(getFutureTickerInfo('ZS', 18));
