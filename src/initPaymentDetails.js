const PaymentDetails = require('./models/PaymentDetails');

async function initPaymentDetails() {
  const count = await PaymentDetails.countDocuments();
  if (count === 0) {
    await PaymentDetails.create({
      phoneNumber: process.env.DEFAULT_PHONE || '+79991234567',
      bankCard: process.env.DEFAULT_CARD || '2200111122223333'
    });
    console.log('✅ Default payment details created');
  }
}

module.exports = initPaymentDetails;