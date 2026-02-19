const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { protect } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * @desc    Create checkout session
 * @route   POST /api/payments/create-checkout
 * @access  Private
 */
const createCheckout = asyncHandler(async (req, res, next) => {
  const { priceId } = req.body;

  if (!priceId) {
    return next(new AppError('Price ID is required', 400));
  }

  // Create or get Stripe customer
  let customerId = req.user.subscription.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: req.user.email,
      name: req.user.name,
      metadata: {
        userId: req.user._id.toString()
      }
    });
    customerId = customer.id;
    
    req.user.subscription.stripeCustomerId = customerId;
    await req.user.save();
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1
      }
    ],
    mode: 'subscription',
    success_url: `${process.env.FRONTEND_URL}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing?cancelled=true`,
    metadata: {
      userId: req.user._id.toString()
    }
  });

  res.status(200).json({
    success: true,
    sessionId: session.id,
    url: session.url
  });
});

/**
 * @desc    Create portal session
 * @route   POST /api/payments/create-portal
 * @access  Private
 */
const createPortal = asyncHandler(async (req, res, next) => {
  const customerId = req.user.subscription.stripeCustomerId;

  if (!customerId) {
    return next(new AppError('No subscription found', 404));
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.FRONTEND_URL}/dashboard`
  });

  res.status(200).json({
    success: true,
    url: session.url
  });
});

/**
 * @desc    Stripe webhook handler
 * @route   POST /api/payments/webhook
 * @access  Public (Stripe)
 */
const handleWebhook = asyncHandler(async (req, res, next) => {
  const sig = req.headers['stripe-signature'];
  
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object);
      break;
    
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object);
      break;
    
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;
    
    case 'invoice.payment_succeeded':
      logger.info('Invoice payment succeeded');
      break;
    
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
    
    default:
      logger.info(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Helper functions
const handleCheckoutComplete = async (session) => {
  const userId = session.metadata.userId;
  const user = await User.findById(userId);

  if (user) {
    logger.info(`Checkout completed for user: ${user.email}`);
  }
};

const handleSubscriptionUpdate = async (subscription) => {
  const user = await User.findOne({ 
    'subscription.stripeCustomerId': subscription.customer 
  });

  if (user) {
    user.subscription.plan = 'pro';
    user.subscription.status = subscription.status;
    user.subscription.stripeSubscriptionId = subscription.id;
    user.subscription.currentPeriodStart = new Date(subscription.current_period_start * 1000);
    user.subscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    user.subscription.cancelAtPeriodEnd = subscription.cancel_at_period_end;
    
    await user.save();
    logger.info(`Subscription updated for user: ${user.email}`);
  }
};

const handleSubscriptionDeleted = async (subscription) => {
  const user = await User.findOne({ 
    'subscription.stripeSubscriptionId': subscription.id 
  });

  if (user) {
    user.subscription.plan = 'free';
    user.subscription.status = 'expired';
    user.subscription.stripeSubscriptionId = null;
    user.subscription.currentPeriodEnd = null;
    
    await user.save();
    logger.info(`Subscription cancelled for user: ${user.email}`);
  }
};

const handlePaymentFailed = async (invoice) => {
  logger.error(`Payment failed for customer: ${invoice.customer}`);
  // Here you could send an email notification
};

router.post('/create-checkout', protect, createCheckout);
router.post('/create-portal', protect, createPortal);
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

module.exports = router;
