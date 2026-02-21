function getFutureTicker(baseSymbol, monthsAhead) {
    const now = new Date();
    // Use fixed date for testing since local time was Feb 20, 2026
    const testDate = new Date(2026, 1, 20); 
    const targetDate = new Date(testDate.getFullYear(), testDate.getMonth() + monthsAhead, 1);
    const year = targetDate.getFullYear().toString().slice(-2);
    const month = targetDate.getMonth() + 1; // 1-12

    let validMonths;
    if (baseSymbol === 'ZS') {
        validMonths = [
            {m: 1, c: 'F', n: 'Jan'}, {m: 3, c: 'H', n: 'Mar'}, {m: 5, c: 'K', n: 'Mai'}, 
            {m: 7, c: 'N', n: 'Jul'}, {m: 8, c: 'Q', n: 'Ago'}, {m: 9, c: 'U', n: 'Set'}, 
            {m: 11, c: 'X', n: 'Nov'}
        ];
    } else {
        validMonths = [
            {m: 1, c: 'F', n: 'Jan'}, {m: 3, c: 'H', n: 'Mar'}, {m: 5, c: 'K', n: 'Mai'}, 
            {m: 7, c: 'N', n: 'Jul'}, {m: 8, c: 'Q', n: 'Ago'}, {m: 9, c: 'U', n: 'Set'}, 
            {m: 10, c: 'V', n: 'Out'}, {m: 12, c: 'Z', n: 'Dez'}
        ];
    }

    let futureMonth = validMonths.find(v => v.m >= month);
    let finalYear = year;
    if (!futureMonth) {
        futureMonth = validMonths[0];
        finalYear = (targetDate.getFullYear() + 1).toString().slice(-2);
    }

    return {
        ticker: `${baseSymbol}${futureMonth.c}${finalYear}.CBT`,
        name: futureMonth.n,
        targetMonth: month,
        targetYear: year
    };
}

console.log(getFutureTicker('ZS', 18));
console.log(getFutureTicker('ZM', 18));
console.log(getFutureTicker('ZL', 18));
