#!/usr/bin/env node

/**
 * Cline Memory Bank Context Checker
 * 
 * Quick utility to check current task context and project state
 * Run: node check-context.js
 */

const fs = require('fs');
const path = require('path');

function checkContext() {
  console.log('🧠 Cline Memory Bank - Context Check\n');
  console.log('=' .repeat(50));
  
  try {
    // Read context file
    const contextPath = path.join(__dirname, 'cline-context.json');
    if (!fs.existsSync(contextPath)) {
      console.log('❌ cline-context.json not found!');
      console.log('💡 Run this from the project root directory');
      return;
    }
    
    const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
    
    // Current Task Status
    console.log('📋 CURRENT TASK STATUS');
    console.log('-'.repeat(25));
    if (context.currentTask) {
      console.log(`🎯 Active Task: ${context.currentTask.title}`);
      console.log(`📝 Status: ${context.currentTask.status}`);
      console.log(`🔍 Focus: ${context.currentTask.currentFocus || 'Not specified'}`);
      console.log(`📁 Files in Scope: ${context.currentTask.filesInScope?.join(', ') || 'None specified'}`);
      console.log(`⏰ Started: ${new Date(context.currentTask.startedAt).toLocaleString()}`);
    } else {
      console.log('✅ No active task - Ready for new work');
    }
    
    console.log('\n📈 RECENT COMPLETED TASKS');
    console.log('-'.repeat(30));
    if (context.recentTasks && context.recentTasks.length > 0) {
      context.recentTasks.slice(0, 3).forEach((task, index) => {
        console.log(`${index + 1}. ${task.title} (${task.completedAt})`);
        console.log(`   📋 ${task.summary}`);
      });
    } else {
      console.log('No recent tasks found');
    }
    
    console.log('\n🏗️ SYSTEM STATE');
    console.log('-'.repeat(15));
    console.log(`🏛️ Architecture: ${context.systemState?.architecture || 'Not specified'}`);
    console.log(`🔄 Processing Flow: ${context.systemState?.processingFlow || 'Not specified'}`);
    console.log(`📊 Last Updated: ${new Date(context.lastUpdated).toLocaleString()}`);
    
    console.log('\n✅ STABLE FEATURES (Do not modify)');
    console.log('-'.repeat(35));
    if (context.systemState?.knownStableFeatures) {
      context.systemState.knownStableFeatures.forEach((feature, index) => {
        console.log(`${index + 1}. ${feature}`);
      });
    }
    
    console.log('\n🚫 DO NOT REVISIT');
    console.log('-'.repeat(18));
    if (context.doNotRevisit && context.doNotRevisit.length > 0) {
      context.doNotRevisit.forEach((item, index) => {
        console.log(`${index + 1}. ${item}`);
      });
    } else {
      console.log('No items marked as do not revisit');
    }
    
    console.log('\n📝 CONTEXT RULES');
    console.log('-'.repeat(16));
    if (context.contextRules && context.contextRules.length > 0) {
      context.contextRules.forEach((rule, index) => {
        console.log(`${index + 1}. ${rule}`);
      });
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('💡 For full documentation, see: CLINE_MEMORY_BANK_README.md');
    console.log('📁 Task documentation in: tasks/ directory');
    console.log('🎯 Project overview: project-state.md');
    
  } catch (error) {
    console.error('❌ Error reading context:', error.message);
    console.log('💡 Make sure cline-context.json is valid JSON');
  }
}

// Run the context check
checkContext();
