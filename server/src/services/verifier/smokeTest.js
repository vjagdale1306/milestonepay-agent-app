import '../../loadEnv.js';
import { verifySubmission } from './geminiVerifier.js';

async function runSmokeTest() {
  console.log('--- Verifier Smoke Test ---');

  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY (or LLM_API_KEY) is not set in .env');
    process.exit(1);
  }

  const sampleBrief = 'Build a responsive header component with navigation links and logo.';
  const sampleCriteria = '1. Contains a brand logo\n2. Contains at least 3 navigation links\n3. Implements responsive mobile toggle button';
  const sampleSubmission = `
import React, { useState } from 'react';

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="logo">MilestonePay</div>
      <button className="mobile-toggle" onClick={() => setIsOpen(!isOpen)}>Menu</button>
      <nav className={isOpen ? 'nav-open' : 'nav-closed'}>
        <a href="#home">Home</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>
  );
}
`;

  console.log('Sending sample deliverable to Gemini verifier...');
  try {
    const result = await verifySubmission({
      brief: sampleBrief,
      acceptanceCriteria: sampleCriteria,
      submissionContent: sampleSubmission,
    });

    console.log('Smoke Test Results:');
    console.log(`- Decision:           ${result.decision}`);
    console.log(`- Model Hint:         ${result.modelDecision}`);
    console.log(`- Confidence:         ${result.confidence}`);
    console.log(`- Requirements Count: ${result.requirements.length}`);
    console.log(`- Reason:             ${result.reason}`);
    console.log(`- Feedback (snippet): ${String(result.feedback || '').slice(0, 200)}`);
    console.log('---------------------------');
  } catch (err) {
    console.error('Smoke test failed with unexpected exception:', err.message);
    process.exit(1);
  }
}

runSmokeTest();

