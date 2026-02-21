const YahooFinance = require('yahoo-finance2').default;

async function run() {
    try {
        // Current month
        console.log("ZS=F", await YahooFinance.quote('ZS=F'));
        // August 2027 should be ZSQ27.CBT
        console.log("ZSQ27.CBT", await YahooFinance.quote('ZSQ27.CBT'));
        console.log("ZSQ27.CBOT", await YahooFinance.quote('ZSQ27.CBOT'));
    } catch (e) {
        console.log("Error:", e.message);
    }
}
run();
