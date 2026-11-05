import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// 1. Resolve dotenv from server/node_modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(path.resolve(__dirname, '../server/package.json'));
const dotenv = require('dotenv');

// 2. Load .env from project root regardless of the current working directory
const envPathFromDir = path.resolve(__dirname, '../.env');
const envPathFromCwd = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPathFromDir)) {
  dotenv.config({ path: envPathFromDir });
} else if (fs.existsSync(envPathFromCwd)) {
  dotenv.config({ path: envPathFromCwd });
} else {
  dotenv.config(); // fallback
}

// 3. Import PayPal service functions
import {
  createAuthorizeOrder,
  authorizeOrder,
  captureAuthorization,
} from '../server/src/services/paypal/index.js';

function promptUser(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

async function runSandboxCheck() {
  console.log('=============================================');
  console.log(' MilestonePay Agent - PayPal Sandbox Check   ');
  console.log('=============================================\n');

  // Verify credentials exist without printing secrets or access tokens
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    console.error('Error: PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET missing in .env');
    process.exit(1);
  }

  const testAmount = '10.00';
  console.log(`[Step 1] Creating Order with intent: AUTHORIZE for $${testAmount} USD...`);

  try {
    const order = await createAuthorizeOrder({
      amount: testAmount,
      referenceId: 'sandbox_check_01',
      customId: 'milestone_check_test',
    });

    console.log(`✓ Order Created Successfully!`);
    console.log(`  - Order ID: ${order.orderId}`);
    console.log(`  - Status:   ${order.status}`);
    console.log(`\n=============================================`);
    console.log(`APPROVAL URL:`);
    console.log(order.approvalUrl);
    console.log(`=============================================\n`);

    console.log('Please open the approval URL above in your browser and approve the authorization');
    console.log('using your PayPal Sandbox buyer account.\n');

    await promptUser('Press [Enter] AFTER you have completed the approval in your browser: ');

    console.log('\n[Step 2] Authorizing the order to lock funds...');
    const authResult = await authorizeOrder(order.orderId);
    console.log(`✓ Order Authorized Successfully!`);
    console.log(`  - Order ID:         ${authResult.orderId}`);
    console.log(`  - Authorization ID: ${authResult.authorizationId}`);
    console.log(`  - Status:           ${authResult.status}`);

    console.log('\n[Step 3] Capturing the authorized payment...');
    const captureResult = await captureAuthorization(authResult.authorizationId);
    console.log(`✓ Payment Captured Successfully!`);
    console.log(`  - Capture ID:        ${captureResult.captureId}`);
    console.log(`  - Authorization ID:  ${captureResult.authorizationId}`);
    console.log(`  - Status:            ${captureResult.status}`);
    console.log(`  - Amount:            ${captureResult.amount?.value} ${captureResult.amount?.currency_code}`);

    console.log('\n=============================================');
    console.log('✓ All steps completed successfully!');
    console.log('=============================================\n');
  } catch (error) {
    console.error('\n✗ Sandbox Check Failed:');
    console.error(error.message);
    process.exit(1);
  }
}

runSandboxCheck();

