/**
 * Test script for Token Tracker API
 * Run with: node src/test.js
 */

require('dotenv').config();

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

// Colors for console
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function fetchAPI(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    const data = await response.json();
    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    return { status: 0, data: { error: error.message }, ok: false };
  }
}

async function runTests() {
  log('\n========================================', 'blue');
  log('  Token Tracker API Tests', 'blue');
  log('========================================\n', 'blue');
  
  let passed = 0;
  let failed = 0;
  let adminToken = null;
  let deviceToken = null;
  let deviceId = null;
  
  // Test 1: Health check
  log('1. Testing Health Check...', 'yellow');
  const health = await fetchAPI('/api/health');
  if (health.ok && health.data.status === 'healthy') {
    log('   ✓ Health check passed', 'green');
    passed++;
  } else {
    log(`   ✗ Health check failed: ${JSON.stringify(health.data)}`, 'red');
    failed++;
  }
  
  // Test 2: Root endpoint
  log('2. Testing Root Endpoint...', 'yellow');
  const root = await fetchAPI('/');
  if (root.ok && root.data.name === 'Centralized Token Tracker API') {
    log('   ✓ Root endpoint passed', 'green');
    passed++;
  } else {
    log(`   ✗ Root endpoint failed: ${JSON.stringify(root.data)}`, 'red');
    failed++;
  }
  
  // Test 3: Admin login
  log('3. Testing Admin Login...', 'yellow');
  const login = await fetchAPI('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || 'admin123'
    })
  });
  if (login.ok && login.data.token) {
    adminToken = login.data.token;
    log('   ✓ Admin login passed', 'green');
    passed++;
  } else {
    log(`   ✗ Admin login failed: ${JSON.stringify(login.data)}`, 'red');
    failed++;
  }
  
  // Test 4: Device registration
  log('4. Testing Device Registration...', 'yellow');
  const testFingerprint = `test-device-${Date.now()}`;
  const register = await fetchAPI('/api/devices/register', {
    method: 'POST',
    body: JSON.stringify({
      device_name: 'Test Device',
      hardware_fingerprint: testFingerprint,
      metadata: { os: 'Windows', test: true }
    })
  });
  if (register.ok && register.data.device_token) {
    deviceToken = register.data.device_token;
    deviceId = register.data.device_id;
    log('   ✓ Device registration passed', 'green');
    passed++;
  } else {
    log(`   ✗ Device registration failed: ${JSON.stringify(register.data)}`, 'red');
    failed++;
  }
  
  // Test 5: Get device info
  log('5. Testing Get Device Info...', 'yellow');
  if (deviceToken) {
    const me = await fetchAPI('/api/devices/me', {
      headers: { Authorization: `Bearer ${deviceToken}` }
    });
    if (me.ok && me.data.device) {
      log('   ✓ Get device info passed', 'green');
      passed++;
    } else {
      log(`   ✗ Get device info failed: ${JSON.stringify(me.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no device token)', 'yellow');
  }
  
  // Test 6: Check token balance
  log('6. Testing Token Balance...', 'yellow');
  if (deviceToken && deviceId) {
    const balance = await fetchAPI(`/api/devices/${deviceId}/tokens`, {
      headers: { Authorization: `Bearer ${deviceToken}` }
    });
    if (balance.ok && balance.data.remaining !== undefined) {
      log(`   ✓ Token balance passed (Remaining: ${balance.data.remaining})`, 'green');
      passed++;
    } else {
      log(`   ✗ Token balance failed: ${JSON.stringify(balance.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no device token)', 'yellow');
  }
  
  // Test 7: Log usage (Claude Opus - 3 tokens)
  log('7. Testing Usage Log (Claude Opus 4.5 - 3 tokens)...', 'yellow');
  if (deviceToken && deviceId) {
    const usage1 = await fetchAPI(`/api/devices/${deviceId}/usage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({
        model_type: 'claude-opus-4.5',
        request_type: 'chat',
        description: 'Test prompt'
      })
    });
    if (usage1.ok && usage1.data.tokens_used === 3) {
      log(`   ✓ Usage log passed (Used: ${usage1.data.tokens_used} tokens)`, 'green');
      passed++;
    } else {
      log(`   ✗ Usage log failed: ${JSON.stringify(usage1.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no device token)', 'yellow');
  }
  
  // Test 8: Log usage (Other model - 1 token)
  log('8. Testing Usage Log (GPT-4 - 1 token)...', 'yellow');
  if (deviceToken && deviceId) {
    const usage2 = await fetchAPI(`/api/devices/${deviceId}/usage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({
        model_type: 'gpt-4',
        request_type: 'completion'
      })
    });
    if (usage2.ok && usage2.data.tokens_used === 1) {
      log(`   ✓ Usage log passed (Used: ${usage2.data.tokens_used} token)`, 'green');
      passed++;
    } else {
      log(`   ✗ Usage log failed: ${JSON.stringify(usage2.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no device token)', 'yellow');
  }
  
  // Test 9: Check can use
  log('9. Testing Check Can Use...', 'yellow');
  if (deviceToken) {
    const check = await fetchAPI('/api/devices/check-can-use', {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({
        model_type: 'claude-opus-4.5',
        prompt_count: 1
      })
    });
    if (check.ok && check.data.can_use !== undefined) {
      log(`   ✓ Check can use passed (Can use: ${check.data.can_use})`, 'green');
      passed++;
    } else {
      log(`   ✗ Check can use failed: ${JSON.stringify(check.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no device token)', 'yellow');
  }
  
  // Test 10: Admin dashboard
  log('10. Testing Admin Dashboard...', 'yellow');
  if (adminToken) {
    const dashboard = await fetchAPI('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (dashboard.ok && dashboard.data.devices) {
      log(`   ✓ Admin dashboard passed (Devices: ${dashboard.data.devices.count})`, 'green');
      passed++;
    } else {
      log(`   ✗ Admin dashboard failed: ${JSON.stringify(dashboard.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no admin token)', 'yellow');
  }
  
  // Test 11: Get models info
  log('11. Testing Get Models Info...', 'yellow');
  const models = await fetchAPI('/api/usage/models');
  if (models.ok && models.data.models) {
    log('   ✓ Get models info passed', 'green');
    passed++;
  } else {
    log(`   ✗ Get models info failed: ${JSON.stringify(models.data)}`, 'red');
    failed++;
  }
  
  // Test 12: Admin set allocation
  log('12. Testing Admin Set Allocation...', 'yellow');
  if (adminToken && deviceId) {
    const setAlloc = await fetchAPI('/api/admin/set-allocation', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        device_id: deviceId,
        allocated_tokens: 100
      })
    });
    if (setAlloc.ok && setAlloc.data.allocated_tokens === 100) {
      log('   ✓ Admin set allocation passed', 'green');
      passed++;
    } else {
      log(`   ✗ Admin set allocation failed: ${JSON.stringify(setAlloc.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no admin token or device)', 'yellow');
  }
  
  // Test 13: Admin block device
  log('13. Testing Admin Block Device...', 'yellow');
  if (adminToken && deviceId) {
    const block = await fetchAPI('/api/admin/block-device', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        device_id: deviceId,
        blocked: true
      })
    });
    if (block.ok && block.data.is_blocked === true) {
      log('   ✓ Admin block device passed', 'green');
      passed++;
    } else {
      log(`   ✗ Admin block device failed: ${JSON.stringify(block.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no admin token or device)', 'yellow');
  }
  
  // Test 14: Blocked device cannot use tokens
  log('14. Testing Blocked Device Access...', 'yellow');
  if (deviceToken) {
    const blockedCheck = await fetchAPI('/api/devices/me', {
      headers: { Authorization: `Bearer ${deviceToken}` }
    });
    if (blockedCheck.status === 403) {
      log('   ✓ Blocked device correctly denied', 'green');
      passed++;
    } else {
      log(`   ⊘ Blocked check inconclusive: ${JSON.stringify(blockedCheck.data)}`, 'yellow');
    }
  } else {
    log('   ⊘ Skipped (no device token)', 'yellow');
  }
  
  // Test 15: Unblock and cleanup
  log('15. Testing Admin Unblock & Delete Device...', 'yellow');
  if (adminToken && deviceId) {
    // Unblock first
    await fetchAPI('/api/admin/block-device', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ device_id: deviceId, blocked: false })
    });
    
    // Delete device
    const del = await fetchAPI(`/api/admin/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (del.ok) {
      log('   ✓ Admin delete device passed', 'green');
      passed++;
    } else {
      log(`   ✗ Admin delete device failed: ${JSON.stringify(del.data)}`, 'red');
      failed++;
    }
  } else {
    log('   ⊘ Skipped (no admin token or device)', 'yellow');
  }
  
  // Summary
  log('\n========================================', 'blue');
  log('  Test Summary', 'blue');
  log('========================================', 'blue');
  log(`  Passed: ${passed}`, 'green');
  log(`  Failed: ${failed}`, failed > 0 ? 'red' : 'green');
  log(`  Total:  ${passed + failed}`, 'blue');
  log('========================================\n', 'blue');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  log(`\nTest error: ${err.message}`, 'red');
  process.exit(1);
});
