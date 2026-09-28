
// ═══════════════════════════════════════════════════════
//  AttendIQ – SRM Smart Attendance Dashboard
//  Semester: Aug 29, 2026 – Nov 29, 2026
// ═══════════════════════════════════════════════════════

const SEM_START = new Date('2026-08-29');
const SEM_END   = new Date('2026-11-29');
const THRESH_75 = 75;
const THRESH_90 = 90;

let timetableData = null;
let currentSection = null;
let currentResults = [];
let radarChartInst = null;
let barChartInst   = null;
let leaveType      = 'OD';

// ── Helpers ──────────────────────────────────────────
function workdaysBetween(a, b) {
  let count = 0;
  let d = new Date(a);
  d.setHours(0,0,0,0);
  let end = new Date(b);
  end.setHours(0,0,0,0);
  while (d <= end) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function getWeekdayName(date) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()];
}

// Count how many times a subject slot appears from start→end date
function countSubjectPeriods(sectionKey, subjectSlot, fromDate, toDate) {
  const sec = timetableData.sections[sectionKey];
  if (!sec) return 0;
  const schedule = sec.schedule;
  let count = 0;
  let d = new Date(fromDate);
  d.setHours(0,0,0,0);
  let end = new Date(toDate);
  end.setHours(0,0,0,0);
  while (d <= end) {
    const dayName = getWeekdayName(d);
    if (dayName !== 'Sunday' && dayName !== 'Saturday') {
      const periods = schedule[dayName] || [];
      count += periods.filter(p => p === subjectSlot).length;
    }
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function today() {
  const t = new Date();
  t.setHours(0,0,0,0);
  return t;
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});
}

function pctClass(pct) {
  if (pct >= THRESH_90) return 'safe';
  if (pct >= THRESH_75) return 'warning';
  return 'danger';
}

// ── Load timetable ────────────────────────────────────
async function loadTimetable() {
  const res = await fetch('timetable_data.json');
  timetableData = await res.json();
  populateSectionDropdown();
}

function populateSectionDropdown() {
  const sel = document.getElementById('sectionSelect');
  Object.entries(timetableData.sections).forEach(([key, sec]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = sec.label;
    sel.appendChild(opt);
  });
}

// ── Section change ────────────────────────────────────
document.getElementById('sectionSelect').addEventListener('change', function() {
  const key = this.value;
  currentSection = key;
  if (!key) {
    document.getElementById('subjectInputArea').classList.add('hidden');
    return;
  }
  renderSubjectInputs(key);
  document.getElementById('subjectInputArea').classList.remove('hidden');
});

function renderSubjectInputs(key) {
  const sec = timetableData.sections[key];
  const grid = document.getElementById('subjectInputsGrid');
  grid.innerHTML = '';
  // Filter to only "real" academic subjects (slot is single letter A-I)
  const acad = sec.subjects.filter(s => /^[A-Z]$/.test(s.slot));
  acad.forEach(sub => {
    const div = document.createElement('div');
    div.className = 'subject-input-item';
    div.innerHTML = `
      <span class="slot-badge">Slot ${sub.slot}</span>
      <div class="sub-name">${sub.name}</div>
      <input type="number" id="att_${sub.slot}" min="0" max="100"
             placeholder="0–100 %" value="" />
    `;
    grid.appendChild(div);
  });
}

// ── Calculate ─────────────────────────────────────────
document.getElementById('calculateBtn').addEventListener('click', calculate);

function calculate() {
  if (!currentSection) return;

  const todayDate = today();
  const targetInput = document.getElementById('targetDate').value;
  const targetDate = targetInput ? new Date(targetInput) : new Date(SEM_END);
  targetDate.setHours(0,0,0,0);

  const effectiveEnd = targetDate > SEM_END ? SEM_END : targetDate;
  const effectiveEnd2 = new Date(effectiveEnd);

  const sec = timetableData.sections[currentSection];
  const acad = sec.subjects.filter(s => /^[A-Z]$/.test(s.slot));

  currentResults = [];
  let detentionSubs = [];

  acad.forEach(sub => {
    const input = document.getElementById(`att_${sub.slot}`);
    const currentPct = parseFloat(input.value);

    if (isNaN(currentPct) || currentPct < 0 || currentPct > 100) {
      input.style.borderColor = '#ef4444';
      return;
    }
    input.style.borderColor = '';

    // Periods already held (sem start → today-1)
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const totalSoFar = countSubjectPeriods(currentSection, sub.slot, SEM_START, yesterday);

    // Periods remaining (today → effectiveEnd)
    const remaining = countSubjectPeriods(currentSection, sub.slot, todayDate, effectiveEnd);

    // Back-calculate attended so far
    const attendedSoFar = totalSoFar > 0
      ? Math.round((currentPct / 100) * totalSoFar)
      : 0;

    const totalClasses = totalSoFar + remaining;

    // To stay ≥75%: need ceil(0.75 * total) – attendedSoFar
    const need75 = Math.max(0, Math.ceil(0.75 * totalClasses) - attendedSoFar);

    // To reach ≥90%
    const need90 = Math.max(0, Math.ceil(0.90 * totalClasses) - attendedSoFar);

    // Irreversible detention check: even if student attends ALL remaining, can they hit 75%?
    const bestPossible = totalClasses > 0
      ? ((attendedSoFar + remaining) / totalClasses) * 100
      : currentPct;
    const irreversible = bestPossible < THRESH_75;

    // Max skippable and stay ≥75%
    const canSkip75 = remaining - need75;
    const canSkip90 = remaining - need90;

    // Projected if attending all
    const projectedIfAll = totalClasses > 0
      ? ((attendedSoFar + remaining) / totalClasses * 100).toFixed(1)
      : currentPct.toFixed(1);

    const result = {
      slot: sub.slot,
      name: sub.name,
      code: sub.code,
      currentPct,
      totalSoFar,
      remaining,
      totalClasses,
      attendedSoFar,
      need75,
      need90,
      canSkip75: Math.max(0, canSkip75),
      canSkip90: Math.max(0, canSkip90),
      bestPossible: bestPossible.toFixed(1),
      projectedIfAll,
      irreversible,
      status: pctClass(currentPct)
    };
    currentResults.push(result);

    if (irreversible) detentionSubs.push(sub.name);
  });

  if (currentResults.length === 0) return;

  // Countdown
  const daysLeft = Math.max(0, Math.ceil((effectiveEnd - todayDate) / 86400000));
  document.getElementById('semesterCountdown').textContent =
    `Planning up to ${formatDate(effectiveEnd)} · ${daysLeft} days remaining`;

  // Overall badge
  const worstStatus = currentResults.some(r => r.status === 'danger') ? 'danger'
    : currentResults.some(r => r.status === 'warning') ? 'warning' : 'safe';
  const badgeEl = document.getElementById('overallBadge');
  badgeEl.className = `health-badge ${worstStatus}`;
  badgeEl.textContent = worstStatus === 'safe' ? '✅ Looking Good!'
    : worstStatus === 'warning' ? '⚠️ Needs Attention' : '🚨 Danger Zone';

  renderCharts();
  renderSubjectCards();
  populateLeaveSubjects();

  document.getElementById('resultsSection').classList.remove('hidden');
  document.getElementById('resultsSection').scrollIntoView({behavior:'smooth'});

  // Detention modal
  if (detentionSubs.length > 0) {
    document.getElementById('detentionMsg').innerHTML =
      `<strong>${detentionSubs.join(', ')}</strong><br><br>
      Even if you attend 100% of remaining classes, your attendance in these subjects
      will still be below 75%. Detention is now mathematically inevitable.
      Contact your class advisor immediately.`;
    document.getElementById('detentionModal').classList.remove('hidden');
  }
}

// ── Charts ────────────────────────────────────────────
function renderCharts() {
  const labels = currentResults.map(r => r.slot + ' – ' + r.name.split(' ').slice(0,3).join(' '));
  const data75 = currentResults.map(() => 75);
  const data90 = currentResults.map(() => 90);
  const dataActual = currentResults.map(r => r.currentPct);
  const colors = currentResults.map(r =>
    r.status === 'safe' ? 'rgba(34,197,94,0.8)'
    : r.status === 'warning' ? 'rgba(245,158,11,0.8)'
    : 'rgba(239,68,68,0.8)'
  );

  // Radar
  if (radarChartInst) radarChartInst.destroy();
  const rCtx = document.getElementById('radarChart').getContext('2d');
  radarChartInst = new Chart(rCtx, {
    type: 'radar',
    data: {
      labels: currentResults.map(r => r.slot),
      datasets: [
        { label: 'Your Attendance', data: dataActual,
          backgroundColor: 'rgba(108,99,255,0.25)',
          borderColor: '#6c63ff', borderWidth: 2, pointBackgroundColor: colors },
        { label: '75% Line', data: data75,
          backgroundColor: 'transparent',
          borderColor: 'rgba(239,68,68,0.5)', borderWidth: 1, borderDash: [4,4],
          pointRadius: 0 },
        { label: '90% Line', data: data90,
          backgroundColor: 'transparent',
          borderColor: 'rgba(34,197,94,0.5)', borderWidth: 1, borderDash: [4,4],
          pointRadius: 0 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: {
        r: {
          min: 0, max: 100,
          grid: { color: 'rgba(255,255,255,0.07)' },
          ticks: { color: '#64748b', font: { size: 10 } },
          pointLabels: { color: '#e2e8f0', font: { size: 11, weight: '600' } }
        }
      },
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } }
    }
  });

  // Bar
  if (barChartInst) barChartInst.destroy();
  const bCtx = document.getElementById('barChart').getContext('2d');
  barChartInst = new Chart(bCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Current %', data: dataActual, backgroundColor: colors, borderRadius: 8 },
        { label: '75% Threshold', data: data75,
          type: 'line', borderColor: '#ef4444', borderDash: [6,3],
          borderWidth: 2, pointRadius: 0, fill: false },
        { label: '90% Target', data: data90,
          type: 'line', borderColor: '#22c55e', borderDash: [6,3],
          borderWidth: 2, pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: {
        y: { min: 0, max: 100,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b' } },
        x: { ticks: { color: '#94a3b8', maxRotation: 45, font: { size: 10 } },
          grid: { display: false } }
      },
      plugins: { legend: { labels: { color: '#94a3b8' } } }
    }
  });
}

// ── Subject Cards ─────────────────────────────────────
function renderSubjectCards() {
  const container = document.getElementById('subjectCards');
  container.innerHTML = '';
  currentResults.forEach(r => {
    const card = document.createElement('div');
    card.className = `sub-card ${r.status}`;
    const pctFill = Math.min(100, r.currentPct);
    const skip90Color = r.canSkip90 > 0 ? 'green' : 'red';
    const skip75Color = r.canSkip75 > 0 ? 'yellow' : 'red';

    let alertHtml = '';
    if (r.irreversible) {
      alertHtml = `<div class="alert-chip danger-chip">🚨 Irreversible Detention – contact advisor immediately!</div>`;
    } else if (r.status === 'danger') {
      alertHtml = `<div class="alert-chip danger-chip">⚠️ Must attend ${r.need75} more classes to exit danger zone</div>`;
    } else if (r.status === 'warning') {
      alertHtml = `<div class="alert-chip warn-chip">📌 Need ${r.need90 > 0 ? r.need90 + ' more classes' : 'to maintain'} to reach 90%</div>`;
    } else {
      alertHtml = `<div class="alert-chip ok-chip">✅ Can safely skip up to ${r.canSkip90} class${r.canSkip90!==1?'es':''} and stay ≥90%</div>`;
    }

    card.innerHTML = `
      <div class="sub-card-header">
        <div class="sub-card-name">${r.name}</div>
        <div class="sub-card-slot">Slot ${r.slot}</div>
      </div>
      <div class="sub-card-pct">${r.currentPct.toFixed(1)}%</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pctFill}%"></div></div>
      <div class="sub-card-stats">
        <div class="stat-row"><span class="stat-label">Held so far</span><span class="stat-val">${r.totalSoFar} classes</span></div>
        <div class="stat-row"><span class="stat-label">Attended</span><span class="stat-val">${r.attendedSoFar} classes</span></div>
        <div class="stat-row"><span class="stat-label">Remaining</span><span class="stat-val">${r.remaining} classes</span></div>
        <div class="stat-row"><span class="stat-label">To hit 75%</span><span class="stat-val ${r.need75===0?'green':'red'}">${r.need75===0?'Already safe':r.need75+' needed'}</span></div>
        <div class="stat-row"><span class="stat-label">To hit 90%</span><span class="stat-val ${skip90Color}">${r.need90===0?'Already ≥90%':r.need90+' needed'}</span></div>
        <div class="stat-row"><span class="stat-label">Safe to skip (75%)</span><span class="stat-val ${skip75Color}">${r.canSkip75} class${r.canSkip75!==1?'es':''}</span></div>
        <div class="stat-row"><span class="stat-label">Best possible</span><span class="stat-val">${r.bestPossible}%</span></div>
      </div>
      ${alertHtml}
    `;
    container.appendChild(card);
  });
}

// ── OD Simulator ──────────────────────────────────────
function populateLeaveSubjects() {
  const sel = document.getElementById('leaveSubjects');
  sel.innerHTML = '';
  currentResults.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.slot;
    opt.textContent = `Slot ${r.slot} – ${r.name}`;
    sel.appendChild(opt);
  });
}

document.getElementById('odBtn').addEventListener('click', function() {
  leaveType = 'OD';
  this.classList.add('active');
  document.getElementById('medBtn').classList.remove('active');
});
document.getElementById('medBtn').addEventListener('click', function() {
  leaveType = 'Medical';
  this.classList.add('active');
  document.getElementById('odBtn').classList.remove('active');
});

document.getElementById('simulateBtn').addEventListener('click', simulateLeave);

function simulateLeave() {
  const startInput = document.getElementById('leaveStartDate').value;
  const days = parseInt(document.getElementById('leaveDays').value) || 1;
  const selectedSlots = Array.from(document.getElementById('leaveSubjects').selectedOptions).map(o => o.value);

  if (!startInput || selectedSlots.length === 0) {
    alert('Please fill in leave start date and select at least one subject.');
    return;
  }

  const leaveStart = new Date(startInput);
  const leaveEnd   = new Date(leaveStart);
  leaveEnd.setDate(leaveEnd.getDate() + days - 1);

  const resDiv = document.getElementById('simulationResults');
  resDiv.classList.remove('hidden');
  let html = `<div class="sim-title">📋 ${leaveType} Simulation: ${formatDate(leaveStart)} → ${formatDate(leaveEnd)}</div>`;

  currentResults.filter(r => selectedSlots.includes(r.slot)).forEach(r => {
    // Classes lost in leave period
    const classesLost = countSubjectPeriods(currentSection, r.slot, leaveStart, leaveEnd);

    // For OD: classes count as attended (no impact)
    // For Medical: classes lost but total may be treated as absent
    const newAttended = leaveType === 'OD'
      ? r.attendedSoFar + classesLost  // OD counts as present
      : r.attendedSoFar;               // Medical = absent

    const newPct = r.totalClasses > 0
      ? (newAttended / r.totalClasses * 100).toFixed(1)
      : r.currentPct.toFixed(1);

    const newStatus = pctClass(parseFloat(newPct));
    const arrow = parseFloat(newPct) < r.currentPct ? '↘️' : (leaveType==='OD' ? '→' : '↘️');

    html += `
      <div class="sim-row">
        <span class="sim-subject">Slot ${r.slot} – ${r.name.split(' ').slice(0,3).join(' ')}</span>
        <span class="sim-before">${r.currentPct.toFixed(1)}%</span>
        <span>${arrow}</span>
        <span class="sim-after ${newStatus}">${newPct}% (${classesLost} class${classesLost!==1?'es':''} affected)</span>
      </div>
    `;
    if (leaveType === 'Medical' && parseFloat(newPct) < THRESH_75) {
      html += `<div class="alert-chip danger-chip" style="margin:0 0 8px">🚨 Medical leave drops below 75%!</div>`;
    }
  });

  if (selectedSlots.length === 0) html += '<p style="color:var(--muted)">No subjects selected.</p>';
  resDiv.innerHTML = html;
}

// ── Chatbot ───────────────────────────────────────────
const chatFab   = document.getElementById('chatFab');
const chatPanel = document.getElementById('chatPanel');
const chatClose = document.getElementById('chatClose');
const chatInput = document.getElementById('chatInput');
const chatSend  = document.getElementById('chatSend');
const chatMsgs  = document.getElementById('chatMessages');

chatFab.addEventListener('click', () => { chatPanel.classList.toggle('open'); });
chatClose.addEventListener('click', () => chatPanel.classList.remove('open'));
chatSend.addEventListener('click', handleChat);
chatInput.addEventListener('keydown', e => { if(e.key==='Enter') handleChat(); });

function appendMsg(text, role) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="msg-bubble">${text}</div>`;
  chatMsgs.appendChild(div);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  return div;
}

function handleChat() {
  const q = chatInput.value.trim();
  if (!q) return;
  appendMsg(q, 'user');
  chatInput.value = '';
  const typingDiv = appendMsg('⠋ Thinking…', 'bot typing');
  setTimeout(() => {
    const answer = answerQuery(q);
    typingDiv.remove();
    appendMsg(answer, 'bot');
  }, 600);
}

function answerQuery(q) {
  const lq = q.toLowerCase();

  if (currentResults.length === 0) {
    return "Please first select your section, enter attendance percentages, and click <strong>Calculate</strong> so I can see your data! 📊";
  }

  // Parse numbers from query
  const nums = q.match(/\d+/g)?.map(Number) || [];

  // ── "skip N days" / "take N days off" ──
  const skipMatch = lq.match(/skip\s+(\d+)|take\s+(\d+)|(\d+)\s*day/);
  const skipDays = skipMatch ? parseInt(skipMatch[1]||skipMatch[2]||skipMatch[3]) : null;

  // ── "can I miss X classes" ──
  const missMatch = lq.match(/miss\s+(\d+)\s*class/);

  // ── subject keyword matching ──
  function findSubject(str) {
    return currentResults.find(r =>
      str.includes(r.name.toLowerCase()) ||
      str.includes(r.slot.toLowerCase()) ||
      str.includes(r.code.toLowerCase()) ||
      r.name.toLowerCase().split(' ').some(w => w.length > 4 && str.includes(w))
    );
  }

  // ── Worst subject ──
  if (lq.includes('worst') || lq.includes('most attention') || lq.includes('lowest')) {
    const worst = [...currentResults].sort((a,b) => a.currentPct - b.currentPct)[0];
    return `Your lowest attendance is in <strong>${worst.name}</strong> (Slot ${worst.slot}) at <strong>${worst.currentPct.toFixed(1)}%</strong>. 
      You need to attend <strong>${worst.need75}</strong> more classes to hit 75% and <strong>${worst.need90}</strong> to reach 90%.`;
  }

  // ── Best subject ──
  if (lq.includes('best') || lq.includes('highest') || lq.includes('top')) {
    const best = [...currentResults].sort((a,b) => b.currentPct - a.currentPct)[0];
    return `Your best attendance is <strong>${best.name}</strong> (Slot ${best.slot}) at <strong>${best.currentPct.toFixed(1)}%</strong>. 
      You can safely skip up to <strong>${best.canSkip75}</strong> more classes and remain ≥75%.`;
  }

  // ── How many can I skip overall ──
  if ((lq.includes('skip') || lq.includes('miss') || lq.includes('bunk')) && !skipDays && !missMatch) {
    const rows = currentResults.map(r =>
      `• <strong>${r.name.split(' ').slice(0,3).join(' ')}</strong>: can skip <strong>${r.canSkip75}</strong> classes (75%) / <strong>${r.canSkip90}</strong> (90%)`
    ).join('<br>');
    return `Here's how many classes you can skip per subject:<br><br>${rows}`;
  }

  // ── Leave simulation query ──
  if (skipDays || missMatch) {
    const days = skipDays || (missMatch ? parseInt(missMatch[1]) : 1);
    // simulate skipping 'days' worth of classes from today
    const todayDate = today();
    const leaveEnd = new Date(todayDate);
    leaveEnd.setDate(leaveEnd.getDate() + days - 1);

    const subToCheck = findSubject(lq);
    const targets = subToCheck ? [subToCheck] : currentResults;

    let resp = `Simulating <strong>${days}-day absence</strong> starting today:<br><br>`;
    targets.forEach(r => {
      const lost = countSubjectPeriods(currentSection, r.slot, todayDate, leaveEnd);
      const newAtt = r.attendedSoFar;
      const newPct = r.totalClasses > 0 ? (newAtt / r.totalClasses * 100).toFixed(1) : r.currentPct.toFixed(1);
      const drop = (r.currentPct - parseFloat(newPct)).toFixed(1);
      const status = pctClass(parseFloat(newPct));
      const emoji = status==='safe'?'✅' : status==='warning'?'⚠️' : '🚨';
      resp += `${emoji} <strong>${r.name.split(' ').slice(0,2).join(' ')}</strong>: ${r.currentPct.toFixed(1)}% → <strong>${newPct}%</strong> (−${drop}%, ${lost} class${lost!==1?'es':''} lost)<br>`;
      if (parseFloat(newPct) < THRESH_75) resp += `&nbsp;&nbsp;&nbsp;🚨 <em>Would drop below 75%!</em><br>`;
    });
    return resp;
  }

  // ── Detention check ──
  if (lq.includes('detent') || lq.includes('safe') || lq.includes('75') || lq.includes('danger')) {
    const detained = currentResults.filter(r => r.status === 'danger');
    const irr = currentResults.filter(r => r.irreversible);
    if (irr.length > 0) {
      return `🚨 <strong>CRITICAL:</strong> You face irreversible detention in:<br>${irr.map(r=>`• ${r.name}`).join('<br>')}<br><br>Even attending ALL remaining classes won't save you. Contact your advisor now.`;
    } else if (detained.length > 0) {
      return `⚠️ You're currently in the danger zone (< 75%) for:<br>${detained.map(r=>`• ${r.name}: ${r.currentPct.toFixed(1)}% (need ${r.need75} more classes)`).join('<br>')}`;
    } else {
      return `✅ Good news! You're above 75% in all subjects. Keep it up!`;
    }
  }

  // ── To reach 90% ──
  if (lq.includes('90') || lq.includes('ninety')) {
    const rows = currentResults.map(r =>
      r.need90 === 0
        ? `✅ <strong>${r.name.split(' ').slice(0,2).join(' ')}</strong>: already ≥90%`
        : `📌 <strong>${r.name.split(' ').slice(0,2).join(' ')}</strong>: need <strong>${r.need90}</strong> more classes`
    ).join('<br>');
    return `To reach/maintain 90%:<br><br>${rows}`;
  }

  // ── Specific subject query ──
  const sub = findSubject(lq);
  if (sub) {
    return `📊 <strong>${sub.name}</strong> (Slot ${sub.slot}):<br>
      • Current: <strong>${sub.currentPct.toFixed(1)}%</strong><br>
      • Attended: ${sub.attendedSoFar} / ${sub.totalSoFar} held<br>
      • Remaining: ${sub.remaining} classes<br>
      • Need for 75%: <strong>${sub.need75===0?'Already safe':sub.need75+' classes'}</strong><br>
      • Need for 90%: <strong>${sub.need90===0?'Already ≥90%':sub.need90+' classes'}</strong><br>
      • Safe to skip (75%): <strong>${sub.canSkip75}</strong> classes<br>
      • Best possible: <strong>${sub.bestPossible}%</strong>`;
  }

  // ── General summary ──
  if (lq.includes('summar') || lq.includes('overview') || lq.includes('status') || lq.includes('how am')) {
    const avg = (currentResults.reduce((s,r)=>s+r.currentPct,0)/currentResults.length).toFixed(1);
    const dangerCount = currentResults.filter(r=>r.status==='danger').length;
    const safeCount = currentResults.filter(r=>r.status==='safe').length;
    return `📊 <strong>Your Attendance Summary:</strong><br>
      • Average: <strong>${avg}%</strong><br>
      • Safe (≥90%): <strong>${safeCount}</strong> subjects<br>
      • Danger (<75%): <strong>${dangerCount}</strong> subjects<br><br>
      Ask me about specific subjects or "how many can I skip?" for details!`;
  }

  return `I can help with:<br>
    • "How many classes can I skip?"<br>
    • "Which subject needs most attention?"<br>
    • "If I take 3 days off, what happens to [subject]?"<br>
    • "Am I in danger of detention?"<br>
    • "How many classes do I need to reach 90%?"`;
}

// ── Detention Modal ───────────────────────────────────
document.getElementById('dismissDetention').addEventListener('click', () => {
  document.getElementById('detentionModal').classList.add('hidden');
});

// ── Init ──────────────────────────────────────────────
function initDateDisplay() {
  const t = new Date();
  document.getElementById('todayChip').textContent =
    '📅 Today: ' + t.toLocaleDateString('en-IN', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
  // Set default planning date
  const defDate = document.getElementById('targetDate');
  defDate.value = '2026-11-29';
  defDate.min = t.toISOString().split('T')[0];
  defDate.max = '2026-11-29';
  document.getElementById('leaveStartDate').min = t.toISOString().split('T')[0];
  document.getElementById('leaveStartDate').max = '2026-11-29';
}

initDateDisplay();
loadTimetable();
