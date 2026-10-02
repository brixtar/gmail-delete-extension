/**
 * Gmail Delete & Smart Grouping Content Script
 * Antigravity - Premium Chrome Extension
 */

(function () {
  'use strict';

  // State
  let panelOpen = false;
  let detectedEmails = [];
  let senderGroups = {};
  let panelEl = null;
  let launcherEl = null;
  let observer = null;

  // Session state (accumulates across pages)
  let autoSelectSenders = new Set();
  let seenEmailsSignature = new Set();
  let sessionGroups = {};

  // Icons SVG definitions for modern look
  const ICONS = {
    trash: `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
    logo: `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4 6h-4v2h4v2h-4v2h4v2H9V7h6v2z"/></svg>`,
    info: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
    sparkles: `<svg viewBox="0 0 24 24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5 5.5-2.5-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>`,
    reset: `<svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>`
  };

  // Helper to check if an element is visible
  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // 1. DELETE SHORTCUT IMPLEMENTATION

  // Simulate complete mouse/pointer click event sequence for Gmail's complex dynamic handlers
  function simulateClick(element) {
    if (!element) return;
    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    events.forEach(type => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1
      });
      element.dispatchEvent(event);
    });
  }
  
  // Find the delete button in Gmail UI (highly resilient strategy)
  function findDeleteButton() {
    // Helper to check if element is inside Gmail's top action toolbar
    const isInToolbar = el => !!(el.closest('[role="toolbar"]') || el.closest('.G-atb') || el.closest('.apG') || el.closest('.T-I-Js-IF'));

    const candidates = [];

    // Strategy A: Find buttons with act="10" (Gmail's internal delete action attribute)
    const act10Buttons = Array.from(document.querySelectorAll('div[act="10"]'));
    act10Buttons.forEach(btn => {
      if (isVisible(btn)) {
        candidates.push({ el: btn, priority: isInToolbar(btn) ? 100 : 90 });
      }
    });

    // Strategy B: Check common localized tooltips / labels containing delete keywords (resilient to shortcuts appended like "Eliminar (#)")
    const keywords = ['eliminar', 'delete', 'borrar', 'trash', 'excluir', 'supprimer', 'löschen'];
    const elementsWithTooltips = Array.from(document.querySelectorAll('[data-tooltip], [aria-label], [title]'));
    
    elementsWithTooltips.forEach(el => {
      if (!isVisible(el)) return;
      
      const tooltip = (el.getAttribute('data-tooltip') || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      
      const matchesKeyword = keywords.some(kw => 
        tooltip.includes(kw) || ariaLabel.includes(kw) || title.includes(kw)
      );
      
      if (matchesKeyword) {
        const role = el.getAttribute('role');
        const tagName = el.tagName;
        // Verify it is a button/clickable element
        if (role === 'button' || tagName === 'BUTTON' || el.classList.contains('T-I') || el.closest('[role="toolbar"]')) {
          candidates.push({ el, priority: isInToolbar(el) ? 80 : 50 });
        }
      }
    });

    // Strategy C: Search by standard trash can SVG path (independent of translation and markup)
    const paths = Array.from(document.querySelectorAll('svg path'));
    paths.forEach(path => {
      const d = path.getAttribute('d') || '';
      if (d.includes('M6 19') || d.includes('M15.5 4l-1-1h-5l-1 1H5v2h14V4z') || d.includes('M16 9v10H8V9h8')) {
        let current = path.parentElement;
        while (current && current !== document.body) {
          if (current.getAttribute('role') === 'button' || current.tagName === 'BUTTON' || current.classList.contains('T-I')) {
            if (isVisible(current)) {
              candidates.push({ el: current, priority: isInToolbar(current) ? 70 : 40 });
              break;
            }
          }
          current = current.parentElement;
        }
      }
    });

    // Sort by priority to ensure we target the main toolbar button first
    candidates.sort((a, b) => b.priority - a.priority);

    if (candidates.length > 0) {
      console.log('[Gmail Delete Extension] Found delete button candidates:', candidates);
      return candidates[0].el;
    }

    return null;
  }

  // Handle keydown events
  function handleKeyDown(event) {
    // Only intercept the "Delete" key
    if (event.key !== 'Delete') return;

    // Check if the user is typing in any editable fields
    const active = document.activeElement;
    if (active) {
      const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
      const isContentEditable = active.getAttribute('contenteditable') === 'true' || active.closest('[contenteditable="true"]');
      
      // If user is editing text, let the normal delete event proceed
      if (isInput || isContentEditable) {
        return;
      }
    }

    // Prevent default delete key action (if any in Gmail outer scope)
    event.preventDefault();

    // Find and click the delete button
    const deleteBtn = findDeleteButton();
    if (deleteBtn) {
      console.log('[Gmail Delete Extension] Tracing delete button click...');
      simulateClick(deleteBtn);
      showToastFeedback("Correo eliminado");
    } else {
      console.warn('[Gmail Delete Extension] Delete button not found or not visible.');
    }
  }

  // Create minor feedback toast in Gmail UI
  function showToastFeedback(message) {
    let toast = document.getElementById('gmsg-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'gmsg-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 96px;
        left: 24px;
        background: rgba(30, 41, 59, 0.9);
        color: #fff;
        padding: 10px 20px;
        border-radius: 10px;
        font-family: 'Outfit', sans-serif;
        font-size: 13px;
        z-index: 1000000;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        pointer-events: none;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.3s ease;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 2000);
  }

  // 2. EMAIL PARSING & GROUPING LOGIC

  // Parse sender info from row element (combining multiple fallbacks)
  function getSenderFromRow(row) {
    // 1. Look for element with email attribute
    const emailEl = row.querySelector('[email]');
    if (emailEl) {
      const email = emailEl.getAttribute('email') || '';
      const name = emailEl.getAttribute('name') || emailEl.textContent.trim() || email.split('@')[0];
      return { name, email };
    }

    // 2. Look for elements with class names commonly used by Gmail for senders (yW, zF, yP)
    const senderClasses = ['.zF', '.yP', '.yW'];
    for (const cls of senderClasses) {
      const el = row.querySelector(cls);
      if (el) {
        const email = el.getAttribute('email');
        const text = el.textContent.trim();
        if (email) {
          const name = el.getAttribute('name') || text || email.split('@')[0];
          return { name, email };
        }
        if (text) {
          // If we only have text, generate a fallback email for grouping
          const cleanText = text.toLowerCase().replace(/[^a-z0-9]/g, '');
          return { name: text, email: cleanText ? `${cleanText}@domain.com` : 'desconocido@gmail.com' };
        }
      }
    }

    return { name: 'Desconocido', email: 'desconocido@gmail.com' };
  }

  // Scan current inbox page for visible emails and update session accumulators
  function scanEmails() {
    console.log('[Gmail Delete Extension] Scanning visible emails...');
    
    // Find all Gmail email rows (standard table row classes: zA, and role="row" as fallback)
    const rows = Array.from(document.querySelectorAll('tr.zA, tr[role="row"]'));
    detectedEmails = [];
    senderGroups = {}; // Temporary mapping of visible emails on current page

    rows.forEach(row => {
      if (!isVisible(row)) return;

      // Ensure it is a valid email row by checking for a checkbox inside
      const checkbox = row.querySelector('[role="checkbox"]');
      if (!checkbox) return; // Ignores headers or other tables

      const sender = getSenderFromRow(row);
      const groupKey = sender.email.toLowerCase();
      
      // Auto-select if sender email is currently in autoSelectSenders
      if (autoSelectSenders.has(groupKey)) {
        const isChecked = checkbox.getAttribute('aria-checked') === 'true';
        if (!isChecked) {
          checkbox.click(); // Autoclick checkbox
        }
      }

      const isChecked = checkbox.getAttribute('aria-checked') === 'true';

      // Extract subject & date to create a unique signature
      const subjectEl = row.querySelector('.y6, .bog');
      const subject = subjectEl ? subjectEl.textContent.trim() : '';

      const dateEl = row.querySelector('.xW, .yX');
      const dateText = dateEl ? dateEl.textContent.trim() : '';

      // Unique signature to avoid double counting across pages / refreshes
      const signature = `${groupKey}|${subject}|${dateText}`;

      const emailData = {
        row,
        sender,
        subject,
        dateText,
        signature,
        checkbox,
        isChecked
      };

      detectedEmails.push(emailData);

      // Track currently visible emails grouped by sender
      if (!senderGroups[groupKey]) {
        senderGroups[groupKey] = {
          name: sender.name,
          email: sender.email,
          emails: []
        };
      }
      senderGroups[groupKey].emails.push(emailData);

      // Session Tracking (Accumulating across page changes)
      if (!sessionGroups[groupKey]) {
        sessionGroups[groupKey] = {
          name: sender.name,
          email: sender.email,
          sessionCount: 0
        };
      }

      if (!seenEmailsSignature.has(signature)) {
        seenEmailsSignature.add(signature);
        sessionGroups[groupKey].sessionCount++;
      }
    });

    renderGroupsList();
    updateFooterStats();
  }

  // Toggle selection state of all emails in a sender group
  function toggleGroupSelection(groupKey) {
    const isCurrentlyAutoSelected = autoSelectSenders.has(groupKey);
    
    if (isCurrentlyAutoSelected) {
      autoSelectSenders.delete(groupKey);
      
      // Deselect all currently visible emails of this sender
      const group = senderGroups[groupKey];
      if (group) {
        group.emails.forEach(email => {
          if (email.checkbox) {
            const isChecked = email.checkbox.getAttribute('aria-checked') === 'true';
            if (isChecked) {
              email.checkbox.click();
            }
          }
        });
      }
    } else {
      autoSelectSenders.add(groupKey);
      
      // Select all currently visible emails of this sender
      const group = senderGroups[groupKey];
      if (group) {
        group.emails.forEach(email => {
          if (email.checkbox) {
            const isChecked = email.checkbox.getAttribute('aria-checked') === 'true';
            if (!isChecked) {
              email.checkbox.click();
            }
          }
        });
      }
    }

    // Re-scan after brief timeout to let Gmail's DOM update
    setTimeout(() => {
      scanEmails();
    }, 100);
  }

  // Reset current session stats and active auto-selections
  function resetSession() {
    autoSelectSenders.clear();
    seenEmailsSignature.clear();
    sessionGroups = {};
    scanEmails();
  }

  // 3. UI RENDER LOGIC

  // Initialize and build UI containers
  function initUI() {
    if (document.getElementById('gmsg-launcher')) return;
    if (!document.body) return; // Safeguard if body isn't fully loaded

    // Create Launcher Button
    launcherEl = document.createElement('div');
    launcherEl.id = 'gmsg-launcher';
    launcherEl.title = 'Agrupamiento Inteligente';
    launcherEl.innerHTML = ICONS.logo;
    document.body.appendChild(launcherEl);

    // Create Panel
    panelEl = document.createElement('div');
    panelEl.id = 'gmsg-panel';
    panelEl.innerHTML = `
      <div class="gmsg-header">
        <div class="gmsg-title-container">
          ${ICONS.sparkles}
          <div class="gmsg-title">Limpieza Inteligente</div>
        </div>
        <div class="gmsg-header-actions">
          <button class="gmsg-icon-btn" id="gmsg-btn-reset" title="Restablecer acumulador de la sesión">
            ${ICONS.reset}
          </button>
          <button class="gmsg-icon-btn" id="gmsg-btn-refresh" title="Actualizar lista">
            ${ICONS.refresh}
          </button>
          <button class="gmsg-icon-btn" id="gmsg-btn-close" title="Cerrar panel">
            ${ICONS.close}
          </button>
        </div>
      </div>
      <div class="gmsg-tabs">
        <button class="gmsg-tab active" id="gmsg-tab-senders">Remitentes</button>
        <button class="gmsg-tab" id="gmsg-tab-help">Cómo usar</button>
      </div>
      <div class="gmsg-body" id="gmsg-panel-body">
        <!-- Rendered lists or states go here -->
      </div>
      <div class="gmsg-footer">
        <div class="gmsg-info-text" id="gmsg-footer-text">0 seleccionados</div>
        <button class="gmsg-delete-btn" id="gmsg-btn-delete-selected" disabled>
          ${ICONS.trash} Borrar Seleccionados
        </button>
      </div>
    `;
    document.body.appendChild(panelEl);

    // Hook up basic events
    launcherEl.addEventListener('click', togglePanel);
    document.getElementById('gmsg-btn-close').addEventListener('click', () => togglePanel(false));
    document.getElementById('gmsg-btn-refresh').addEventListener('click', scanEmails);
    document.getElementById('gmsg-btn-reset').addEventListener('click', () => {
      resetSession();
      showToastFeedback("Sesión y acumulados restablecidos");
    });
    document.getElementById('gmsg-btn-delete-selected').addEventListener('click', deleteSelectedEmails);

    // Tabs events
    const tabSenders = document.getElementById('gmsg-tab-senders');
    const tabHelp = document.getElementById('gmsg-tab-help');

    tabSenders.addEventListener('click', () => {
      tabSenders.classList.add('active');
      tabHelp.classList.remove('active');
      renderGroupsList();
    });

    tabHelp.addEventListener('click', () => {
      tabHelp.classList.add('active');
      tabSenders.classList.remove('active');
      renderHelp();
    });
  }

  // Toggle Panel Open/Closed State
  function togglePanel(forceState) {
    panelOpen = typeof forceState === 'boolean' ? forceState : !panelOpen;
    
    if (panelOpen) {
      panelEl.classList.add('open');
      launcherEl.classList.add('panel-open');
      launcherEl.innerHTML = ICONS.close;
      scanEmails();
      setupMutationObserver(true);
    } else {
      panelEl.classList.remove('open');
      launcherEl.classList.remove('panel-open');
      launcherEl.innerHTML = ICONS.logo;
      setupMutationObserver(false);
    }
  }

  // Setup MutationObserver to refresh lists automatically when Gmail DOM changes
  function setupMutationObserver(enable) {
    if (enable) {
      if (observer) return;
      
      // Observe the main content area of Gmail (standard wrapper)
      const targetNode = document.querySelector('.aeF') || document.body;
      observer = new MutationObserver(() => {
        // Debounce scan to avoid performance hits
        clearTimeout(window.gmsgScanTimeout);
        window.gmsgScanTimeout = setTimeout(() => {
          if (panelOpen) scanEmails();
        }, 800);
      });

      observer.observe(targetNode, {
        childList: true,
        subtree: true
      });
    } else {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }
  }

  // Render the list of groups inside body
  function renderGroupsList() {
    const bodyEl = document.getElementById('gmsg-panel-body');
    if (!bodyEl) return;

    // Check if we are currently on the Senders tab
    const tabSenders = document.getElementById('gmsg-tab-senders');
    if (!tabSenders.classList.contains('active')) return;

    const visibleKeys = Object.keys(senderGroups);

    if (visibleKeys.length === 0) {
      bodyEl.innerHTML = `
        <div class="gmsg-empty-state">
          ${ICONS.logo}
          <div class="gmsg-empty-title">Sin correos detectados</div>
          <div class="gmsg-empty-desc">Abre la bandeja de entrada o una carpeta de correos para agruparlos aquí.</div>
        </div>
      `;
      return;
    }

    // Map visible senders to session-accumulated numbers
    const groupsToRender = visibleKeys.map(key => {
      const visibleGroup = senderGroups[key];
      const sessionGroup = sessionGroups[key] || { sessionCount: visibleGroup.emails.length };
      return {
        key,
        name: visibleGroup.name,
        email: visibleGroup.email,
        visibleCount: visibleGroup.emails.length,
        sessionCount: sessionGroup.sessionCount
      };
    });

    // Sort by session count descending
    groupsToRender.sort((a, b) => b.sessionCount - a.sessionCount);

    let html = '';
    groupsToRender.forEach(group => {
      const isAutoSelected = autoSelectSenders.has(group.key);
      const btnText = isAutoSelected ? 'Desmarcar' : 'Seleccionar';
      const btnClass = isAutoSelected ? 'gmsg-select-btn selected' : 'gmsg-select-btn';
      const badgeClass = isAutoSelected ? 'gmsg-badge active-badge' : 'gmsg-badge';

      html += `
        <div class="gmsg-item">
          <div class="gmsg-item-info">
            <div class="gmsg-item-name" title="${group.name}">${group.name}</div>
            <div class="gmsg-item-email" title="${group.email}">${group.email}</div>
          </div>
          <div class="gmsg-item-actions">
            <div class="${badgeClass}" title="Total detectado en la sesión: ${group.sessionCount} (Visibles en esta página: ${group.visibleCount})">
              ${group.sessionCount}
            </div>
            <button class="${btnClass}" data-group-key="${group.key}">${btnText}</button>
          </div>
        </div>
      `;
    });

    bodyEl.innerHTML = html;

    // Attach click events to group select buttons
    bodyEl.querySelectorAll('.gmsg-select-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = e.target.getAttribute('data-group-key');
        toggleGroupSelection(key);
      });
    });
  }

  // Render Help tab
  function renderHelp() {
    const bodyEl = document.getElementById('gmsg-panel-body');
    if (!bodyEl) return;

    bodyEl.innerHTML = `
      <div class="gmsg-help-card">
        <div class="gmsg-help-title">Borrar con Suprimir (Delete)</div>
        <div class="gmsg-help-desc">
          Cuando estés leyendo cualquier correo o en la bandeja de entrada, simplemente presiona la tecla <span class="gmsg-help-shortcut">Supr</span> (o <span class="gmsg-help-shortcut">Delete</span>) para mandarlo al tacho de basura.
        </div>
      </div>
      <div class="gmsg-help-card">
        <div class="gmsg-help-title">Acumulado entre Páginas</div>
        <div class="gmsg-help-desc">
          Al hacer clic en <strong>Seleccionar</strong> sobre un remitente, se activa la selección automática. Conforme pases de página, la extensión marcará automáticamente todos los correos nuevos que vea de ese remitente y sumará la cantidad en su contador.
        </div>
      </div>
      <div class="gmsg-help-card">
        <div class="gmsg-help-title">Borrar por Grupos</div>
        <div class="gmsg-help-desc">
          1. Activa <strong>Seleccionar</strong> para los remitentes que quieras limpiar.<br>
          2. Navega por las páginas de Gmail; las casillas se marcarán solas.<br>
          3. Presiona la tecla <span class="gmsg-help-shortcut">Supr</span> en tu teclado en cada página para borrarlos al instante.<br>
          4. Puedes reiniciar el contador usando el icono de reinicio en el encabezado.
        </div>
      </div>
    `;
  }

  // Update stats in the footer and enable/disable delete button
  function updateFooterStats() {
    const textEl = document.getElementById('gmsg-footer-text');
    const deleteBtn = document.getElementById('gmsg-btn-delete-selected');
    if (!textEl || !deleteBtn) return;

    // Count checked emails
    const checkedCount = detectedEmails.filter(email => {
      if (email.checkbox) {
        return email.checkbox.getAttribute('aria-checked') === 'true';
      }
      return false;
    }).length;

    textEl.textContent = `${checkedCount} seleccionados`;
    
    if (checkedCount > 0) {
      deleteBtn.disabled = false;
    } else {
      deleteBtn.disabled = true;
    }
  }

  // Trigger main Gmail delete button to delete checked emails
  function deleteSelectedEmails() {
    const deleteBtn = findDeleteButton();
    if (deleteBtn) {
      simulateClick(deleteBtn);
      showToastFeedback("Correos eliminados");
      setTimeout(() => {
        scanEmails();
      }, 500);
    } else {
      console.warn('[Gmail Delete Extension] Cannot delete: main delete button not found.');
    }
  }

  // 4. EXTENSION INITIALIZATION

  function init() {
    console.log('[Gmail Delete Extension] Initializing keyboard listener...');
    
    // Add KeyDown Listener
    window.addEventListener('keydown', handleKeyDown, true);

    // Dynamic UI Poller (checks if body is loaded, then initializes)
    let initAttempts = 0;
    const initInterval = setInterval(() => {
      initAttempts++;
      if (document.body) {
        clearInterval(initInterval);
        initUI();
        console.log('[Gmail Delete Extension] Extension UI successfully loaded.');
      } else if (initAttempts > 60) { // Limit attempts to 1 minute
        clearInterval(initInterval);
        console.error('[Gmail Delete Extension] Failed to initialize UI: document.body not found.');
      }
    }, 1000);
  }

  // Initialize
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }

})();
