const SUPABASE_URL = 'https://ssdphnukjtjqageqfyeu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_eb5lIWekDOh8Osk9IGydGA_Jw1MktBZ';
let supabaseClient;

let currentUser = null;
let currentAprobarPlanId = null;
let currentTabPlanes = 'todos';
let currentTabAlertas = 'todas';
let selectedReportPlanId = null;
let comentariosPorModulo = {};

function cerrarModalAbierto() {
  const modales = document.querySelectorAll('.modal[style*="flex"]');
  modales.forEach(m => m.style.display = 'none');
}

function showToast(message, type = 'info') {
  const existing = document.querySelector('.peti-toast');
  if (existing) existing.remove();
  if (type === 'success') cerrarModalAbierto();

  const iconMap = { success: 'bi-check-circle-fill', error: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
  const toast = document.createElement('div');
  toast.className = `peti-toast toast-${type}`;
  toast.innerHTML = `<div class="toast-content"><i class="bi ${iconMap[type] || iconMap.info}"></i><span>${message}</span></div>`;
  document.body.appendChild(toast);

  if (!document.getElementById('toast-styles')) {
    const s = document.createElement('style'); s.id = 'toast-styles';
    s.textContent = `.peti-toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#0f172a;border:1px solid #334155;border-radius:3rem;padding:0.7rem 1.5rem;z-index:2000;animation:slideUp 0.25s ease;box-shadow:0 10px 20px -5px rgba(0,0,0,0.3);}.toast-content{display:flex;align-items:center;gap:0.7rem;color:white;font-size:0.85rem;font-weight:500;}.toast-success i{color:#22c55e;}.toast-error i{color:#f97316;}.toast-info i{color:#3b82f6;}@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(20px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}`;
    document.head.appendChild(s);
  }
  setTimeout(() => toast.remove(), 3500);
}

async function insertAuditoria(accion, detalle) {
  try {
    const { error } = await supabaseClient.from('auditoria').insert({
      usuario_id: currentUser.id || null,
      modulo: 'planes',
      accion: accion,
      detalle: detalle,
      usuario_email: currentUser.email || currentUser.username + '@contaperu.pe',
      usuario_nombre: currentUser.username || null
    });
    if (error) {
      console.error('Error insertando auditoría:', error);
      console.warn('⚠️ RLS en tabla auditoria está bloqueando el INSERT. Ejecuta el SQL de corrección en Supabase Dashboard.');
    }
  } catch (e) {
    console.error('Excepción insertando auditoría:', e);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const session = localStorage.getItem('peti_session');
  if (!session) { window.location.href = '../index.html'; return; }
  currentUser = JSON.parse(session);
  if (currentUser.role !== 'aprobador') { showToast('No tienes permiso para acceder a este panel.', 'error'); window.location.href = '../index.html'; return; }

  // Restaurar sesión de Supabase para que las queries incluyan el token JWT
  await supabaseClient.auth.getSession();

  const { data: userRecord, error: userLookupError } = await supabaseClient.from('usuarios').select('id,email').eq('auth_user_id', currentUser.user_id).maybeSingle();
  if (userLookupError) console.error('Error buscando usuario:', userLookupError);
  if (userRecord) { currentUser.id = userRecord.id; currentUser.email = userRecord.email; }
  else { console.warn('No se encontró registro en tabla usuarios para auth_user_id:', currentUser.user_id); }
  document.getElementById('userNameDisplay').innerText = currentUser.username;

  await cargarDashboard();
  await cargarActualizacionesRecientes();
  await cargarPlanesGenerados();
  await actualizarBadges();
  await cargarM01Global();

  // Navegación sidebar
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.preventDefault();
      const sectionId = item.getAttribute('data-section');
      if (sectionId === 'aprobar') await cargarAprobarPlanes();
      if (sectionId === 'empresa') await cargarM01Global();
      if (sectionId === 'planes') await cargarPlanesGenerados();
      if (sectionId === 'alertas') await cargarAlertasConFiltros();
      document.querySelectorAll('.section-content').forEach(sec => sec.classList.remove('active-section'));
      document.getElementById(sectionId).classList.add('active-section');
      document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    localStorage.removeItem('peti_session');
    window.location.href = '../index.html';
  });

  document.getElementById('currentDate').innerText = `Último acceso: ${new Date().toLocaleString()}`;

  // Rechazo modal
  document.getElementById('rechazoConfirmBtn').addEventListener('click', confirmarRechazo);
  document.getElementById('rechazoCancelBtn').addEventListener('click', () => { document.getElementById('rechazoModal').style.display = 'none'; });

  // Obs modal
  document.getElementById('obsConfirmBtn').addEventListener('click', confirmarAprobacionConObs);
  document.getElementById('obsCancelBtn').addEventListener('click', () => { document.getElementById('observacionModal').style.display = 'none'; });

  // Escalar modal
  document.getElementById('escalarConfirmBtn').addEventListener('click', confirmarEscalar);
  document.getElementById('escalarCancelBtn').addEventListener('click', () => { document.getElementById('escalarAlertaModal').style.display = 'none'; });

  // Nuevo plan
  document.getElementById('nuevoPlanBtn').addEventListener('click', abrirModalNuevoPlan);
  document.getElementById('nuevoPlanSaveBtn').addEventListener('click', crearNuevoPlan);
  document.getElementById('nuevoPlanCancelBtn').addEventListener('click', () => { document.getElementById('nuevoPlanModal').style.display = 'none'; });

  // Editar nombre plan
  document.getElementById('editarNombreCancelBtn').addEventListener('click', () => { document.getElementById('editarNombrePlanModal').style.display = 'none'; });
  document.getElementById('editarNombreSaveBtn').addEventListener('click', async () => {
    const planId = document.getElementById('editarNombrePlanId').value;
    const nuevoNombre = document.getElementById('editarNombreInput').value.trim();
    if (!nuevoNombre) { showToast('El nombre no puede estar vacío.', 'error'); return; }

    const { data: plan } = await supabaseClient.from('planes').select('nombre').eq('id', planId).single();
    if (!plan) { showToast('Plan no encontrado.', 'error'); return; }

    if (plan.nombre === nuevoNombre) { showToast('No se encontraron cambios.', 'info'); return; }

    const { error } = await supabaseClient.from('planes').update({ nombre: nuevoNombre }).eq('id', planId);
    if (error) { showToast('Error al actualizar: ' + error.message, 'error'); return; }

    await insertAuditoria('Renombrar plan', `Plan ID ${planId} renombrado de "${plan.nombre}" a "${nuevoNombre}"`);

    document.getElementById('editarNombrePlanModal').style.display = 'none';
    showToast('Nombre actualizado exitosamente.', 'success');
    await cargarPlanesGenerados();
  });

  // Tabs Planes
  document.querySelectorAll('#planesTabs .itab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('#planesTabs .itab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTabPlanes = tab.getAttribute('data-tab');
      await cargarPlanesGenerados();
    });
  });

  // Tabs Alertas
  document.querySelectorAll('#alertasTabs .itab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('#alertasTabs .itab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTabAlertas = tab.getAttribute('data-tab');
      await cargarAlertasConFiltros();
    });
  });

  // Reportes: selector de plan
  document.getElementById('reportePlanSelector').addEventListener('change', async function() {
    selectedReportPlanId = this.value ? parseInt(this.value) : null;
    await onPlanSeleccionado();
  });

  // Modal detalles actualización
  document.getElementById('detallesCerrarBtn').addEventListener('click', async function() {
    const tipo = this.getAttribute('data-tipo-reporte');
    document.getElementById('detallesActualizacionModal').style.display = 'none';
    if (tipo && selectedReportPlanId) {
      await registrarLectura(selectedReportPlanId, tipo);
    }
  });
});

// ==================== BADGES ====================

async function actualizarBadges() {
  const { count: countAprobar } = await supabaseClient.from('planes').select('*', { count: 'exact', head: true }).eq('estado', 'en_revision');
  const { count: countAlertas } = await supabaseClient.from('alertas').select('*', { count: 'exact', head: true }).eq('revisado', false);
  const badgeA = document.getElementById('navAprobarBadge');
  const badgeB = document.getElementById('navAlertasBadge');
  if (badgeA) { if (countAprobar > 0) { badgeA.style.display = 'inline-block'; badgeA.innerText = countAprobar; } else badgeA.style.display = 'none'; }
  if (badgeB) { if (countAlertas > 0) { badgeB.style.display = 'inline-block'; badgeB.innerText = countAlertas; } else badgeB.style.display = 'none'; }
}

// ==================== DASHBOARD ====================

async function cargarDashboard() {
  const { data: planes } = await supabaseClient.from('planes').select('estado');
  if (!planes) return;
  document.getElementById('totalPlanes').innerText = planes.length;
  document.getElementById('planesActivos').innerText = planes.filter(p => p.estado === 'activo').length;
  document.getElementById('planesEnRevision').innerText = planes.filter(p => p.estado === 'en_revision').length;
}

async function cargarActualizacionesRecientes() {
  const { data } = await supabaseClient
    .from('plan_contenido')
    .select('*, planes!inner(nombre), modulos!inner(nombre)')
    .not('completado_fecha', 'is', null)
    .order('completado_fecha', { ascending: false })
    .limit(25);
  const tbody = document.getElementById('recentUpdatesBody');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:2rem;">No hay actualizaciones recientes</td></tr>'; return; }
  tbody.innerHTML = data.map(pc => `
    <tr>
      <td><strong>${pc.planes?.nombre || 'Plan #' + pc.plan_id}</strong></td>
      <td>${pc.modulos?.nombre || pc.modulo_id}</td>
      <td><span class="${pc.completado ? 'badge-active' : 'badge-inactive'}">${pc.completado ? 'Completado' : 'Pendiente'}</span></td>
      <td>${pc.completado_fecha ? new Date(pc.completado_fecha).toLocaleString() : '—'}</td>
    </tr>`).join('');
}

// ==================== INFO EMPRESA (M01 global) ====================

async function cargarM01Global() {
  try {
    const { data: empresa } = await supabaseClient.from('empresa').select('*').eq('id', 1).single();
    if (empresa) {
      document.getElementById('aNombre').innerText = empresa.nombre || 'ContaPerú S.A.C.';
      document.getElementById('aSector').innerText = empresa.sector || 'Servicios contables';
    }
    const { data: global } = await supabaseClient.from('empresa_contenido').select('*').eq('id', 1).single();
    const contenido = global || {};
    document.getElementById('aMision').innerText = contenido.mision || 'No se ha registrado la misión.';
    document.getElementById('aVision').innerText = contenido.vision || 'No se ha registrado la visión.';
    const valores = Array.isArray(contenido.valores) ? contenido.valores : [];
    const container = document.getElementById('aValores');
    if (valores.length === 0) {
      container.innerHTML = '<div class="valor-card" style="flex:1;">No se han registrado valores corporativos aún.</div>';
    } else {
      container.innerHTML = valores.map(v => `<div class="valor-card"><div class="valor-titulo">${v.titulo || v}</div><div class="valor-desc">${v.descripcion || ''}</div></div>`).join('');
    }
  } catch (err) { console.error(err); }
}

// ==================== APROBAR PLAN ====================

async function cargarAprobarPlanes() {
  const { data: modulos } = await supabaseClient.from('modulos').select('*').order('orden');
  const { data: planes } = await supabaseClient.from('planes').select('*, usuarios!creado_por(username)').eq('estado', 'en_revision').order('created_at', { ascending: true });

  const container = document.getElementById('aprobarPlanesList');
  if (!container) return;

  if (!planes || planes.length === 0) {
    document.getElementById('aprobarSubtitle').innerText = '0 planes esperando tu revisión';
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:2rem;"><i class="bi bi-check-circle" style="font-size:2.5rem;display:block;margin-bottom:0.5rem;"></i>No hay planes pendientes de aprobación</div>';
    document.getElementById('lecturaModulosPanel').style.display = 'none';
    // Reset metrics
    document.getElementById('metPendientes').innerText = '0';
    document.getElementById('metAprobados').innerText = '0';
    document.getElementById('metRechazados').innerText = '0';
    document.getElementById('metTiempoProm').innerText = '—';
    return;
  }
  document.getElementById('aprobarSubtitle').innerText = `${planes.length} plan(es) esperando tu revisión · Ordenados por fecha de envío`;

  // Metricas
  const ahora = new Date().getFullYear();
  const { data: aprobados } = await supabaseClient.from('planes').select('estado').eq('estado', 'activo').gte('fecha_aprobacion', `${ahora}-01-01`);
  const { data: rechazados } = await supabaseClient.from('planes').select('estado').eq('estado', 'rechazado').gte('fecha_aprobacion', `${ahora}-01-01`);
  const { data: historial } = await supabaseClient.from('planes').select('fecha_aprobacion, created_at').eq('estado', 'activo').not('fecha_aprobacion', 'is', null).order('fecha_aprobacion', { ascending: false }).limit(50);
  let tiempoProm = '—';
  if (historial && historial.length > 0) {
    const dias = historial.map(p => (new Date(p.fecha_aprobacion) - new Date(p.created_at)) / 86400000).filter(d => d >= 0);
    if (dias.length > 0) tiempoProm = Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) + 'd';
  }
  document.getElementById('metPendientes').innerText = planes.length;
  document.getElementById('metAprobados').innerText = aprobados?.length || 0;
  document.getElementById('metRechazados').innerText = rechazados?.length || 0;
  document.getElementById('metTiempoProm').innerText = tiempoProm;

  // Plan cards
  container.innerHTML = '';
  for (const plan of planes) {
    const { data: contenidos } = await supabaseClient.from('plan_contenido').select('modulo_id, completado').eq('plan_id', plan.id);
    const compMap = Object.fromEntries(contenidos?.map(c => [c.modulo_id, c.completado]) || []);
    const completados = Object.values(compMap).filter(Boolean).length;
    const pct = modulos?.length ? Math.round((completados / modulos.length) * 100) : 0;
    const diasDesde = Math.round((Date.now() - new Date(plan.created_at)) / 86400000);
    const isUrgente = diasDesde >= 3;

    const modChips = modulos.map(m => {
      const ok = compMap[m.id];
      return `<span class="mod-chip ${ok ? 'mod-ok' : 'mod-pend'}">${m.id}</span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = `plan-card ${isUrgente ? 'urgente' : ''}`;
    card.innerHTML = `
      <div class="plan-card-header">
        <span class="pill ${isUrgente ? 'pill-amber' : 'pill-gray'}">En revisión${isUrgente ? ' · urgente' : ''}</span>
        <div class="plan-card-name">${plan.nombre}</div>
        <span style="font-size:0.7rem;color:#94a3b8;">Enviado hace ${diasDesde} día(s)</span>
      </div>
      <div class="plan-card-meta">
        Creado por: ${plan.usuarios?.username || '—'} (Estratega) · ${completados}/${modulos.length} módulos · Plan: ${plan.anio}
      </div>
      <div class="mod-chips">${modChips}</div>
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%;background:${pct >= 100 ? '#27500A' : '#3b82f6'};"></div></div>
      <div class="plan-actions">
        <button class="btn-small btn-secondary" onclick="verResumenEjecutivo(${plan.id})"><i class="bi bi-eye"></i> Ver resumen</button>
        <button class="btn-small btn-secondary" onclick="leerModulosInline(${plan.id})"><i class="bi bi-book"></i> Leer módulos</button>
        <button class="btn-small btn-danger" onclick="abrirModalRechazo(${plan.id})"><i class="bi bi-x-circle"></i> Rechazar</button>
        <button class="btn-small btn-amber" onclick="abrirModalObs(${plan.id})"><i class="bi bi-journal-check"></i> Aprobar con obs.</button>
        <button class="btn-small btn-primary" onclick="aprobarPlan(${plan.id})"><i class="bi bi-check-lg"></i> Aprobar plan</button>
      </div>`;
    container.appendChild(card);
  }
  document.getElementById('lecturaModulosPanel').style.display = 'none';
}

async function aprobarPlan(planId) {
  if (!confirm('¿Está seguro de aprobar este plan? Pasará a estado activo.')) return;
  const { error } = await supabaseClient.from('planes').update({ estado: 'activo', aprobado_por: currentUser.id, fecha_aprobacion: new Date() }).eq('id', planId);
  if (error) { showToast('Error al aprobar el plan: ' + error.message, 'error'); return; }
  await insertAuditoria('Aprobar plan', `Plan ID ${planId} aprobado`);
  showToast('Plan aprobado exitosamente.', 'success');
  await cargarAprobarPlanes();
  await actualizarBadges();
}

window.aprobarPlan = aprobarPlan;

function abrirModalRechazo(planId) {
  currentAprobarPlanId = planId;
  document.getElementById('rechazoPlanId').value = planId;
  document.getElementById('motivoRechazo').value = '';
  document.getElementById('rechazoModal').style.display = 'flex';
}

window.abrirModalRechazo = abrirModalRechazo;

async function confirmarRechazo() {
  const planId = document.getElementById('rechazoPlanId').value;
  const motivo = document.getElementById('motivoRechazo').value.trim();
  if (!motivo) { showToast('Debe ingresar un motivo de rechazo.', 'error'); return; }
  const { error } = await supabaseClient.from('planes').update({ estado: 'rechazado', aprobado_por: currentUser.id, fecha_aprobacion: new Date() }).eq('id', planId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  try { await supabaseClient.from('planes').update({ mensaje_revision: motivo }).eq('id', planId); } catch (_) {}
  await insertAuditoria('Rechazar plan', `Plan ID ${planId} rechazado. Motivo: ${motivo}`);
  document.getElementById('rechazoModal').style.display = 'none';
  showToast('Plan rechazado.', 'success');
  await cargarAprobarPlanes();
  await cargarDashboard();
  await actualizarBadges();
}

function abrirModalObs(planId) {
  currentAprobarPlanId = planId;
  document.getElementById('observacionPlanId').value = planId;
  document.getElementById('observacionTexto').value = '';
  document.getElementById('observacionModal').style.display = 'flex';
}

window.abrirModalObs = abrirModalObs;

async function confirmarAprobacionConObs() {
  const planId = document.getElementById('observacionPlanId').value;
  const obs = document.getElementById('observacionTexto').value.trim();
  const { error } = await supabaseClient.from('planes').update({ estado: 'activo', aprobado_por: currentUser.id, fecha_aprobacion: new Date() }).eq('id', planId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  try { await supabaseClient.from('planes').update({ mensaje_revision: obs || null }).eq('id', planId); } catch (_) {}
    await insertAuditoria('Aprobar con observaciones', `Plan ID ${planId} aprobado. Obs: ${obs || 'Sin observaciones'}`);
  if (obs) {
    const { data: plan } = await supabaseClient.from('planes').select('nombre, creado_por').eq('id', planId).single();
    await supabaseClient.from('alertas').insert({ plan_id: planId, tipo: 'iniciativa', descripcion: `Plan "${plan?.nombre}" aprobado con observaciones: "${obs}"`, revisado: false, destinatario_id: plan?.creado_por || null });
  }
  document.getElementById('observacionModal').style.display = 'none';
  showToast('Plan aprobado con observaciones.', 'success');
  await cargarAprobarPlanes();
  await cargarDashboard();
  await actualizarBadges();
}

// ==================== LECTURA INLINE (ACCORDION) ====================

async function leerModulosInline(planId) {
  const panel = document.getElementById('lecturaModulosPanel');
  const { data: modulos } = await supabaseClient.from('modulos').select('*').order('orden');
  const { data: contenidos } = await supabaseClient.from('plan_contenido').select('modulo_id, contenido, completado').eq('plan_id', planId);
  const contMap = Object.fromEntries(contenidos?.map(c => [c.modulo_id, c]) || []);
  comentariosPorModulo = {};

  let html = `<div class="lectura-header"><h3 style="font-size:1rem;">Lectura del Plan #${planId}</h3><button class="btn-small btn-secondary" onclick="document.getElementById('lecturaModulosPanel').style.display='none'"><i class="bi bi-x-lg"></i> Cerrar</button></div>`;
  for (const m of modulos) {
    const c = contMap[m.id];
    const texto = c?.contenido ? (typeof c.contenido === 'string' ? c.contenido : JSON.stringify(c.contenido, null, 2)) : '(Sin contenido registrado)';
    html += `
    <div class="lectura-modulo">
      <div class="lectura-modulo-header" onclick="toggleLecturaModulo(this)">
        <span><strong>${m.id}</strong> ${m.nombre} <span class="mod-chip ${c?.completado ? 'mod-ok' : 'mod-pend'}">${c?.completado ? 'Completado' : 'Pendiente'}</span></span>
        <i class="bi bi-chevron-down"></i>
      </div>
      <div class="lectura-modulo-body">
        <div style="background:#f8fafc;padding:0.5rem;border-radius:0.5rem;margin-bottom:0.5rem;">${texto}</div>
        <textarea placeholder="Dejar comentario sobre este módulo..." oninput="comentariosPorModulo['${m.id}']=this.value"></textarea>
      </div>
    </div>`;
  }
  panel.innerHTML = html;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
}

window.leerModulosInline = leerModulosInline;

window.toggleLecturaModulo = function(header) {
  const body = header.nextElementSibling;
  const icon = header.querySelector('i');
  body.classList.toggle('open');
  icon.classList.toggle('bi-chevron-down');
  icon.classList.toggle('bi-chevron-up');
};

// ==================== VER RESUMEN EJECUTIVO ====================

async function verResumenEjecutivo(planId) {
  const { data: plan } = await supabaseClient.from('planes').select('*').eq('id', planId).single();
  if (!plan) return;
  const { data: m01 } = await supabaseClient.from('plan_contenido').select('contenido').eq('plan_id', planId).eq('modulo_id', 'M01').single();
  const info = m01?.contenido || {};
  const { data: foo } = await supabaseClient.from('foda').select('tipo, descripcion').eq('plan_id', planId);
  const foda = { fortalezas: [], debilidades: [], oportunidades: [], amenazas: [] };
  (foo || []).forEach(f => { if (f.tipo === 'fortaleza') foda.fortalezas.push(f.descripcion); else if (f.tipo === 'debilidad') foda.debilidades.push(f.descripcion); else if (f.tipo === 'oportunidad') foda.oportunidades.push(f.descripcion); else if (f.tipo === 'amenaza') foda.amenazas.push(f.descripcion); });

  document.getElementById('detallePlanContenido').innerHTML = `
    <div style="display:grid;gap:0.8rem;">
      <h4>${plan.nombre} (${plan.anio})</h4>
      <p style="color:#475569;">${plan.descripcion || 'Sin descripción.'}</p>
      ${info.mision ? `<div><strong>Misión:</strong> ${info.mision}</div>` : ''}
      ${info.vision ? `<div><strong>Visión:</strong> ${info.vision}</div>` : ''}
      <div><strong>FODA:</strong> F:${foda.fortalezas.length} D:${foda.debilidades.length} O:${foda.oportunidades.length} A:${foda.amenazas.length}</div>
      <div><span class="pill ${plan.estado === 'en_revision' ? 'pill-amber' : plan.estado === 'activo' ? 'pill-green' : 'pill-gray'}">${plan.estado}</span></div>
    </div>`;
  document.getElementById('detallePlanModal').style.display = 'flex';
}

window.verResumenEjecutivo = verResumenEjecutivo;

window.cerrarDetallePlan = () => { document.getElementById('detallePlanModal').style.display = 'none'; };

// ==================== PLANES GENERADOS ====================

async function cargarPlanesGenerados() {
  const { data: modulos } = await supabaseClient.from('modulos').select('*').order('orden');

  let query = supabaseClient.from('planes').select('*, usuarios!creado_por(username)').order('anio', { ascending: false });
  if (currentTabPlanes === 'activo') query = query.eq('estado', 'activo');
  else if (currentTabPlanes === 'en_revision') query = query.eq('estado', 'en_revision');
  else if (currentTabPlanes === 'borrador') query = query.eq('estado', 'borrador');
  else if (currentTabPlanes === 'archivado') query = query.or('estado.eq.cerrado,estado.eq.rechazado');
  // 'todos' -> sin filtro

  const { data: planes } = await query;
  const container = document.getElementById('planesCardsList');
  const totalPlanes = await supabaseClient.from('planes').select('id', { count: 'exact', head: true });
  const activos = await supabaseClient.from('planes').select('id', { count: 'exact', head: true }).eq('estado', 'activo');

  if (!container) return;
  document.getElementById('planesSubtitle').innerText = `${totalPlanes.count} planes en total · ${activos.count} activo(s) en ejecución`;

  // Update tab counts
  const counts = { todos: totalPlanes.count || 0 };
  for (const estado of ['activo', 'en_revision', 'borrador']) {
    const { count } = await supabaseClient.from('planes').select('id', { count: 'exact', head: true }).eq('estado', estado);
    counts[estado] = count || 0;
  }
  const { count: arch } = await supabaseClient.from('planes').select('id', { count: 'exact', head: true }).or('estado.eq.cerrado,estado.eq.rechazado');
  counts['archivado'] = arch || 0;

  const tabLabels = { todos: 'Todos', activo: 'Activos', en_revision: 'En revisión', borrador: 'Borradores', archivado: 'Archivados' };
  document.querySelectorAll('#planesTabs .itab').forEach(tab => {
    const key = tab.getAttribute('data-tab');
    tab.innerText = `${tabLabels[key] || key} (${counts[key] || 0})`;
  });

  if (!planes || planes.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:2rem;">No hay planes que mostrar</div>';
    return;
  }

  container.innerHTML = '';
  for (const plan of planes) {
    const { data: contenidos } = await supabaseClient.from('plan_contenido').select('modulo_id, completado').eq('plan_id', plan.id);
    const compMap = Object.fromEntries(contenidos?.map(c => [c.modulo_id, c.completado]) || []);
    const completados = Object.values(compMap).filter(Boolean).length;
    const pct = modulos?.length ? Math.round((completados / modulos.length) * 100) : 0;

    let iconBg = '#F1EFE8', iconColor = '#888', iconClass = 'bi-archive';
    let estadoClass = '', estadoLabel = plan.estado;
    if (plan.estado === 'activo') { iconBg = '#EAF3DE'; iconColor = '#27500A'; iconClass = 'bi-play-circle-fill'; estadoClass = 'activo'; }
    else if (plan.estado === 'en_revision') { iconBg = '#FAEEDA'; iconColor = '#633806'; iconClass = 'bi-clock'; estadoClass = ''; }
    else if (plan.estado === 'borrador') { iconBg = '#E6F1FB'; iconColor = '#0C447C'; iconClass = 'bi-pencil'; estadoClass = ''; }
    else if (plan.estado === 'rechazado') { iconBg = '#FCEBEB'; iconColor = '#791F1F'; iconClass = 'bi-x-octagon'; estadoClass = 'archivado'; }
    else { iconBg = '#F1EFE8'; iconColor = '#888'; iconClass = 'bi-archive'; estadoClass = 'archivado'; }

    const editBtn = `<button class="btn-small btn-icon" onclick="abrirModalEditarNombre(${plan.id}, '${plan.nombre.replace(/'/g, "\\'")}')" title="Editar nombre"><i class="bi bi-pencil"></i></button>`;
    let accionBtns = editBtn;
    if (plan.estado === 'en_revision') accionBtns += ` <button class="btn-small btn-primary" onclick="irAAprobar(${plan.id})">Ir a revisar</button> <button class="btn-small btn-secondary" onclick="descargarPlanCompleto(${plan.id})"><i class="bi bi-download"></i> Descargar plan completo</button>`;
    else if (plan.estado === 'activo') accionBtns += ` <button class="btn-small btn-secondary" onclick="verResumenEjecutivo(${plan.id})">Ver plan</button> <button class="btn-small btn-secondary" onclick="leerModulosInlineGenerados(${plan.id})">Ver módulos</button> <button class="btn-small btn-secondary" onclick="descargarPlanCompleto(${plan.id})"><i class="bi bi-download"></i> Descargar plan completo</button>`;
    else if (plan.estado === 'borrador') accionBtns += ` <button class="btn-small btn-secondary" onclick="leerModulosInlineGenerados(${plan.id})">Ver módulos</button> <button class="btn-small btn-secondary" onclick="descargarPlanCompleto(${plan.id})"><i class="bi bi-download"></i> Descargar plan completo</button>`;
    else accionBtns += ` <button class="btn-small btn-secondary" onclick="verResumenEjecutivo(${plan.id})">Ver histórico</button>`;

    const card = document.createElement('div');
    card.className = `pgen-card ${estadoClass}`;
    card.innerHTML = `
      <div class="pgen-icon" style="background:${iconBg};"><i class="bi ${iconClass}" style="color:${iconColor};"></i></div>
      <div class="pgen-info">
        <div class="pgen-name">${plan.nombre}</div>
        <div class="pgen-meta">${estadoLabel} · Creado por ${plan.usuarios?.username || '—'} · ${plan.anio}${plan.fecha_aprobacion ? ` · ${new Date(plan.fecha_aprobacion).toLocaleDateString()}` : ''}</div>
        ${plan.estado === 'activo' ? `<div class="progress-bar-wrap" style="width:80px;"><div class="progress-bar-fill" style="width:${pct}%;background:#27500A;"></div></div>` : ''}
      </div>
      <div class="pgen-actions">
        ${pct > 0 ? `<div class="pgen-avance"><span style="color:${plan.estado==='activo'?'#27500A':'#64748b'};">${pct}%</span><span class="pgen-avance-label">avance</span></div>` : ''}
        ${accionBtns}
      </div>`;
    container.appendChild(card);
  }
}

window.irAAprobar = function(planId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const aprobarNav = document.querySelector('.nav-item[data-section="aprobar"]');
  if (aprobarNav) aprobarNav.click();
};

async function leerModulosInlineGenerados(planId) {
  const panel = document.getElementById('planLecturaModulosPanel');
  const { data: modulos } = await supabaseClient.from('modulos').select('*').order('orden');
  const { data: contenidos } = await supabaseClient.from('plan_contenido').select('modulo_id, contenido, completado').eq('plan_id', planId);
  const contMap = Object.fromEntries(contenidos?.map(c => [c.modulo_id, c]) || {});

  let html = `<div class="lectura-header"><h3 style="font-size:1rem;">Módulos del Plan #${planId}</h3><button class="btn-small btn-secondary" onclick="document.getElementById('planLecturaModulosPanel').style.display='none'"><i class="bi bi-x-lg"></i> Cerrar</button></div>`;
  for (const m of modulos) {
    const c = contMap[m.id];
    const texto = c?.contenido ? (typeof c.contenido === 'string' ? c.contenido : JSON.stringify(c.contenido, null, 2)) : '(Sin contenido registrado)';
    html += `
    <div class="lectura-modulo">
      <div class="lectura-modulo-header" onclick="toggleLecturaModulo(this)">
        <span><strong>${m.id}</strong> ${m.nombre} <span class="mod-chip ${c?.completado ? 'mod-ok' : 'mod-pend'}">${c?.completado ? 'Completado' : 'Pendiente'}</span></span>
        <i class="bi bi-chevron-down"></i>
      </div>
      <div class="lectura-modulo-body"><div style="background:#f8fafc;padding:0.5rem;border-radius:0.5rem;">${texto}</div></div>
    </div>`;
  }
  panel.innerHTML = html;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
}

window.leerModulosInlineGenerados = leerModulosInlineGenerados;

// ==================== NUEVO PLAN ====================

function abrirModalNuevoPlan() {
  document.getElementById('nuevoPlanNombre').value = '';
  document.getElementById('nuevoPlanAnio').value = new Date().getFullYear();
  document.getElementById('nuevoPlanDescripcion').value = '';
  document.getElementById('nuevoPlanModal').style.display = 'flex';
}

async function crearNuevoPlan() {
  const nombre = document.getElementById('nuevoPlanNombre').value.trim();
  const anio = new Date().getFullYear();
  const descripcion = document.getElementById('nuevoPlanDescripcion').value.trim();
  if (!nombre) { showToast('El nombre del plan es obligatorio.', 'error'); return; }
  if (!currentUser.id) { showToast('Error al identificar al usuario.', 'error'); return; }

  const { data, error } = await supabaseClient.from('planes').insert({ nombre, anio, descripcion: descripcion || null, estado: 'borrador', creado_por: currentUser.id }).select().single();
  if (error) { showToast('Error al crear el plan: ' + error.message, 'error'); return; }
  await insertAuditoria('Crear plan', `Plan "${nombre}" (ID ${data.id}) creado en estado borrador`);
  document.getElementById('nuevoPlanModal').style.display = 'none';
  showToast('Plan creado exitosamente en estado borrador.', 'success');
  await cargarPlanesGenerados();
  await cargarDashboard();
  await actualizarBadges();
}

window.abrirModalEditarNombre = function(planId, nombreActual) {
  document.getElementById('editarNombrePlanId').value = planId;
  document.getElementById('editarNombreInput').value = nombreActual;
  document.getElementById('editarNombrePlanModal').style.display = 'flex';
};

// ==================== REPORTES ====================

async function cargarPlanSelector() {
  const select = document.getElementById('reportePlanSelector');
  if (!select) return;
  const { data: planes } = await supabaseClient.from('planes').select('id, nombre, anio').order('anio', { ascending: false });
  select.innerHTML = '<option value="">-- Selecciona un plan --</option>' +
    (planes || []).map(p => `<option value="${p.id}">${p.nombre} (${p.anio})</option>`).join('');
  if (!selectedReportPlanId) {
    document.getElementById('reportesContent').style.display = 'none';
  }
}

async function onPlanSeleccionado() {
  const content = document.getElementById('reportesContent');
  if (!selectedReportPlanId) { content.style.display = 'none'; return; }
  content.style.display = 'block';

  const dataCheck = await verificarDatosPlan(selectedReportPlanId);
  const updatesCheck = {};
  for (const tipo of ['resumen','kpis','desempeno','bcg','trazabilidad']) {
    if (dataCheck[tipo]) updatesCheck[tipo] = await verificarActualizaciones(selectedReportPlanId, tipo);
  }
  aplicarEstadoCards(dataCheck, updatesCheck);
  await cargarReportesRecientes();
}

async function verificarDatosPlan(planId) {
  const tipos = ['resumen','kpis','desempeno','bcg','trazabilidad'];
  const result = {};
  const [m01Res, kpisRes, proyRes, bcgRes, fodaRes] = await Promise.all([
    supabaseClient.from('plan_contenido').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
    supabaseClient.from('kpis').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
    supabaseClient.from('proyectos').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
    supabaseClient.from('matriz_bcg').select('plan_id', { count: 'exact', head: true }).eq('plan_id', planId),
    supabaseClient.from('foda').select('id', { count: 'exact', head: true }).eq('plan_id', planId),
  ]);
  result['resumen'] = (m01Res.count || 0) > 0 || (fodaRes.count || 0) > 0;
  result['kpis'] = (kpisRes.count || 0) > 0;
  result['desempeno'] = (proyRes.count || 0) > 0;
  result['bcg'] = (bcgRes.count || 0) > 0;
  result['trazabilidad'] = (fodaRes.count || 0) > 0;
  return result;
}

async function verificarActualizaciones(planId, tipo) {
  const { data: lectura } = await supabaseClient.from('reportes_lectura')
    .select('leido_en')
    .eq('usuario_id', currentUser.id)
    .eq('plan_id', planId)
    .eq('tipo_reporte', tipo)
    .single();

  const desde = lectura?.leido_en ? new Date(lectura.leido_en).toISOString() : '1970-01-01';
  const modulos = {
    resumen: ['empresa','foda','plan_contenido'],
    kpis: ['kpis'],
    desempeno: ['proyectos','tareas'],
    bcg: ['bcg','matriz_bcg'],
    trazabilidad: ['foda','cadena_valor']
  }[tipo] || [];

  const { data: auditoria, error } = await supabaseClient.from('auditoria')
    .select('*')
    .in('modulo', modulos)
    .gt('fecha', desde)
    .order('fecha', { ascending: false })
    .limit(20);

  if (error || !auditoria || auditoria.length === 0) return { hayActualizaciones: false, cantidad: 0, registros: [] };
  return { hayActualizaciones: true, cantidad: auditoria.length, registros: auditoria };
}

async function registrarLectura(planId, tipo) {
  if (!planId || !currentUser) return;
  const { error } = await supabaseClient.from('reportes_lectura').upsert({
    usuario_id: currentUser.id,
    plan_id: planId,
    tipo_reporte: tipo,
    leido_en: new Date()
  }, { onConflict: 'usuario_id,plan_id,tipo_reporte' });
  if (error) console.error('Error registrando lectura:', error);
}

function aplicarEstadoCards(datos, updates) {
  for (const tipo of ['resumen','kpis','desempeno','bcg','trazabilidad']) {
    const card = document.querySelector(`.reporte-card[data-reporte="${tipo}"]`);
    if (!card) continue;
    const tieneDatos = datos[tipo];
    const tieneUpdates = updates[tipo]?.hayActualizaciones;
    const badge = card.querySelector('.update-badge');
    const btnDetalles = card.querySelector('.btn-ver-detalles');
    const btnDescargar = card.querySelector('.btn-descargar');

    if (tieneDatos) {
      card.classList.remove('disabled');
      btnDescargar.disabled = false;
      if (tieneUpdates) {
        if (badge) badge.style.display = 'inline-flex';
        if (btnDetalles) btnDetalles.style.display = 'inline-flex';
      } else {
        if (badge) badge.style.display = 'none';
        if (btnDetalles) btnDetalles.style.display = 'none';
      }
    } else {
      card.classList.add('disabled');
      btnDescargar.disabled = true;
      if (badge) badge.style.display = 'none';
      if (btnDetalles) btnDetalles.style.display = 'none';
    }
  }
}

async function generarYGuardarPDF(tipo, titulo, htmlContenido) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<div style="font-family:Inter,sans-serif;padding:20px;background:white;"><h1 style="color:#0f172a;margin-bottom:0.5rem;">${titulo}</h1>${htmlContenido}<p style="color:#94a3b8;font-size:10px;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">Generado por ContaPerú PETI · ${new Date().toLocaleString()}</p></div>`;
  const opts = { margin: [10,10,10,10], filename: `${tipo}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, logging: false, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
  const pdfBlob = await html2pdf().set(opts).from(wrapper).outputPdf('blob');
  const fileName = `reporte_${tipo}_${Date.now()}.pdf`;
  const { error: uploadError } = await supabaseClient.storage.from('reportes').upload(fileName, pdfBlob, { contentType: 'application/pdf', upsert: false });
  let fileUrl = '';
  if (!uploadError) {
    const { data: publicUrl } = supabaseClient.storage.from('reportes').getPublicUrl(fileName);
    fileUrl = publicUrl?.publicUrl || '';
  }
  await supabaseClient.from('reportes_generados').insert({
    usuario_id: currentUser.id, plan_id: selectedReportPlanId, tipo_reporte: tipo, formato: 'PDF',
    titulo: titulo, archivo_url: fileUrl, archivo_tamano: pdfBlob.size
  });
  // Trigger download
  const a = document.createElement('a'); a.href = URL.createObjectURL(pdfBlob); a.download = `${tipo}.pdf`; a.click(); URL.revokeObjectURL(a.href);

  await registrarLectura(selectedReportPlanId, tipo);
  await onPlanSeleccionado();
  return fileUrl;
}

window.descargarReporte = async function(tipo) {
  if (!selectedReportPlanId) { showToast('Selecciona un plan primero.', 'error'); return; }
  const { data: plan } = await supabaseClient.from('planes').select('nombre, anio').eq('id', selectedReportPlanId).single();
  const planNombre = plan?.nombre || 'PETI';
  let titulo = '', htmlContenido = '';
  if (tipo === 'resumen') {
    titulo = `Resumen Ejecutivo - ${planNombre}`;
    const { data: m01 } = await supabaseClient.from('plan_contenido').select('contenido').eq('plan_id', selectedReportPlanId).eq('modulo_id','M01').single();
    const info = m01?.contenido || {};
    const { data: foo } = await supabaseClient.from('foda').select('tipo,descripcion').eq('plan_id', selectedReportPlanId).limit(20);
    htmlContenido = `<h2 style="color:#334155;">${planNombre} (${plan?.anio})</h2><h3 style="color:#2563eb;">Misión</h3><p>${info.mision || '—'}</p><h3 style="color:#2563eb;">Visión</h3><p>${info.vision || '—'}</p><h3 style="color:#2563eb;">FODA</h3>${(foo||[]).map(f=>`<p><strong>${f.tipo}:</strong> ${f.descripcion}</p>`).join('')}`;
  } else if (tipo === 'kpis') {
    titulo = `Avance de KPIs - ${planNombre}`;
    const { data: kpis } = await supabaseClient.from('kpis').select('*').eq('plan_id', selectedReportPlanId);
    htmlContenido = `<h2 style="color:#334155;">KPIs de ${planNombre}</h2><table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="background:#f8fafc;"><th style="text-align:left;padding:4px;">KPI</th><th style="text-align:right;padding:4px;">Actual</th><th style="text-align:right;padding:4px;">Meta</th></tr>${(kpis||[]).map(k => `<tr><td style="padding:4px;">${k.nombre}</td><td style="text-align:right;padding:4px;">${k.valor_actual || '—'} ${k.unidad||''}</td><td style="text-align:right;padding:4px;">${k.meta || '—'} ${k.unidad||''}</td></tr>`).join('')}</table>`;
  } else if (tipo === 'desempeno') {
    titulo = `Desempeño por Área - ${planNombre}`;
    const { data: proys } = await supabaseClient.from('proyectos').select('nombre, avance, estado').eq('plan_id', selectedReportPlanId);
    htmlContenido = `<h2 style="color:#334155;">Proyectos de ${planNombre}</h2>${(proys||[]).map(p => `<p>${p.nombre}: ${p.avance||0}% (${p.estado})</p>`).join('')}`;
  } else if (tipo === 'bcg') {
    titulo = `Análisis BCG - ${planNombre}`;
    const { data: bcg } = await supabaseClient.from('matriz_bcg').select('datos_uen').eq('plan_id', selectedReportPlanId).single();
    const uens = bcg?.datos_uen || [];
    htmlContenido = `<h2 style="color:#334155;">BCG ${planNombre}</h2>${Array.isArray(uens) ? uens.map((u,i) => `<p>${i+1}. ${u.nombre || 'UEN '+(i+1)}: ${u.cuadrante || '—'}</p>`).join('') : '<p>Sin datos BCG.</p>'}`;
  } else if (tipo === 'trazabilidad') {
    titulo = `Trazabilidad FODA - ${planNombre}`;
    const { data: foo } = await supabaseClient.from('foda').select('*').eq('plan_id', selectedReportPlanId);
    htmlContenido = `<h2 style="color:#334155;">Trazabilidad FODA</h2>${(foo||[]).map(f => `<p><strong>${f.tipo}:</strong> ${f.descripcion}</p>`).join('')}`;
  }
  try {
    await generarYGuardarPDF(tipo, titulo, htmlContenido);
  } catch(e) {
    console.error('Error generando reporte:', e);
    showToast('Error al generar el reporte.', 'error');
  }
};

window.descargarAvanceGeneral = async function() {
  if (!selectedReportPlanId) { showToast('Selecciona un plan primero.', 'error'); return; }
  const { data: plan } = await supabaseClient.from('planes').select('nombre, anio, descripcion').eq('id', selectedReportPlanId).single();
  const planNombre = plan?.nombre || 'PETI';
  const { data: modulos } = await supabaseClient.from('modulos').select('*').order('orden');
  const { data: contenidos } = await supabaseClient.from('plan_contenido').select('modulo_id, completado').eq('plan_id', selectedReportPlanId);
  const { data: kpisAll } = await supabaseClient.from('kpis').select('*').eq('plan_id', selectedReportPlanId);
  const { data: proysAll } = await supabaseClient.from('proyectos').select('*').eq('plan_id', selectedReportPlanId);
  const { data: bcgAll } = await supabaseClient.from('matriz_bcg').select('datos_uen').eq('plan_id', selectedReportPlanId).single();
  const { data: fodaAll } = await supabaseClient.from('foda').select('*').eq('plan_id', selectedReportPlanId).limit(30);

  const compMap = Object.fromEntries((contenidos || []).map(c => [c.modulo_id, c.completado]));
  const completados = Object.values(compMap).filter(Boolean).length;
  const pct = modulos?.length ? Math.round((completados / modulos.length) * 100) : 0;

  let html = `<h1 style="color:#0f172a;">Avance General: ${planNombre} (${plan?.anio || ''})</h1>
    <p style="color:#475569;">${plan?.descripcion || ''}</p>
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Módulos: ${completados}/${modulos.length} (${pct}%)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">${(modulos||[]).map(m => `<tr><td>${m.id} ${m.nombre}</td><td style="text-align:right;">${compMap[m.id] ? 'Completado' : 'Pendiente'}</td></tr>`).join('')}</table>
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">KPIs (${kpisAll?.length || 0})</h2>${(kpisAll||[]).map(k => `<p><strong>${k.nombre}:</strong> ${k.valor_actual || '—'}/${k.meta || '—'} ${k.unidad||''}</p>`).join('')}
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">Proyectos (${proysAll?.length || 0})</h2>${(proysAll||[]).map(p => `<p>${p.nombre}: ${p.avance||0}% (${p.estado})</p>`).join('')}
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">FODA (${fodaAll?.length || 0} items)</h2>${(fodaAll||[]).map(f => `<p><strong>${f.tipo}:</strong> ${f.descripcion}</p>`).join('')}`;
  if (bcgAll?.datos_uen) {
    const uens = Array.isArray(bcgAll.datos_uen) ? bcgAll.datos_uen : [];
    html += `<h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">BCG (${uens.length} UEN)</h2>${uens.map((u,i) => `<p>${i+1}. ${u.nombre || 'UEN '+(i+1)}: ${u.cuadrante || '—'}</p>`).join('')}`;
  }

  try {
    await generarYGuardarPDF('avance_general', `Avance General - ${planNombre}`, html);
  } catch(e) {
    console.error('Error generando avance general:', e);
    showToast('Error al generar el reporte.', 'error');
  }
};

window.descargarPlanCompleto = async function(planId) {
  if (!planId) return;
  const { data: plan } = await supabaseClient.from('planes').select('nombre, anio, descripcion, estado').eq('id', planId).single();
  if (!plan) { showToast('Plan no encontrado.', 'error'); return; }
  const planNombre = plan.nombre;

  const { data: modulos } = await supabaseClient.from('modulos').select('*').order('orden');
  const { data: contenidos } = await supabaseClient.from('plan_contenido').select('modulo_id, completado, contenido').eq('plan_id', planId);
  const { data: kpisAll } = await supabaseClient.from('kpis').select('*').eq('plan_id', planId);
  const { data: proysAll } = await supabaseClient.from('proyectos').select('*').eq('plan_id', planId);
  const { data: bcgAll } = await supabaseClient.from('matriz_bcg').select('datos_uen').eq('plan_id', planId).single();
  const { data: fodaAll } = await supabaseClient.from('foda').select('*').eq('plan_id', planId).limit(50);

  const compMap = Object.fromEntries((contenidos || []).map(c => [c.modulo_id, c.completado]));
  const completados = Object.values(compMap).filter(Boolean).length;
  const pct = modulos?.length ? Math.round((completados / modulos.length) * 100) : 0;

  let html = `<h1 style="color:#0f172a;">${planNombre} (${plan?.anio || ''})</h1>
    <p style="color:#64748b;">Estado: ${plan?.estado || '—'}${plan?.descripcion ? ' · ' + plan.descripcion : ''}</p>
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Módulos: ${completados}/${modulos.length} (${pct}%)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">${(modulos||[]).map(m => `<tr><td style="padding:4px;">${m.id} ${m.nombre}</td><td style="text-align:right;padding:4px;">${compMap[m.id] ? 'Completado' : 'Pendiente'}</td></tr>`).join('')}</table>
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">KPIs (${kpisAll?.length || 0})</h2>${(kpisAll||[]).map(k => `<p><strong>${k.nombre}:</strong> ${k.valor_actual || '—'}/${k.meta || '—'} ${k.unidad||''}</p>`).join('') || '<p style="color:#94a3b8;">Sin KPIs registrados.</p>'}
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">Proyectos (${proysAll?.length || 0})</h2>${(proysAll||[]).map(p => `<p>${p.nombre}: ${p.avance||0}% (${p.estado})</p>`).join('') || '<p style="color:#94a3b8;">Sin proyectos registrados.</p>'}
    <h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">FODA (${fodaAll?.length || 0} items)</h2>${(fodaAll||[]).map(f => `<p><strong>${f.tipo}:</strong> ${f.descripcion}</p>`).join('') || '<p style="color:#94a3b8;">Sin FODA registrado.</p>'}`;
  if (bcgAll?.datos_uen) {
    const uens = Array.isArray(bcgAll.datos_uen) ? bcgAll.datos_uen : [];
    html += `<h2 style="color:#2563eb;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:1rem;">BCG (${uens.length} UEN)</h2>${uens.map((u,i) => `<p>${i+1}. ${u.nombre || 'UEN '+(i+1)}: ${u.cuadrante || '—'}</p>`).join('')}`;
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<div style="font-family:Inter,sans-serif;padding:20px;background:white;">${html}<p style="color:#94a3b8;font-size:10px;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">Generado por ContaPerú PETI · ${new Date().toLocaleString()}</p></div>`;

  try {
    const opts = { margin: [10,10,10,10], filename: `${planNombre.replace(/\s+/g,'_')}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, logging: false, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    const pdfBlob = await html2pdf().set(opts).from(wrapper).outputPdf('blob');
    const a = document.createElement('a'); a.href = URL.createObjectURL(pdfBlob); a.download = `${planNombre.replace(/\s+/g,'_')}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  } catch(e) {
    console.error('Error generando PDF:', e);
    showToast('Error al generar el PDF.', 'error');
  }
};

window.mostrarDetallesActualizacion = async function(tipo) {
  if (!selectedReportPlanId) return;
  const result = await verificarActualizaciones(selectedReportPlanId, tipo);
  if (!result.hayActualizaciones) { showToast('No hay actualizaciones recientes para este reporte.', 'info'); return; }

  const nombres = { resumen:'Resumen Ejecutivo', kpis:'Avance de KPIs', desempeno:'Desempeño por Área', bcg:'Análisis BCG', trazabilidad:'Trazabilidad FODA' };
  document.getElementById('detallesTituloTipo').innerText = nombres[tipo] || tipo;
  document.getElementById('detallesListaCambios').innerHTML = result.registros.map(a => `
    <div class="update-item">
      <div class="update-item-icon" style="background:${a.accion === 'EDITAR' || a.accion === 'ACTUALIZAR' ? '#FAEEDA' : '#E6F1FB'};">
        <span style="color:${a.accion === 'EDITAR' || a.accion === 'ACTUALIZAR' ? '#633806' : '#0C447C'};">${a.accion === 'EDITAR' || a.accion === 'ACTUALIZAR' ? '✎' : '✓'}</span>
      </div>
      <div class="update-item-body">
        <strong>${a.accion}</strong> en <strong>${a.modulo}</strong>: ${a.detalle || 'Sin detalles'}
      </div>
      <div class="update-item-time">${new Date(a.fecha).toLocaleDateString()}</div>
    </div>`).join('');
  document.getElementById('detallesCerrarBtn').setAttribute('data-tipo-reporte', tipo);
  document.getElementById('detallesActualizacionModal').style.display = 'flex';
};

async function cargarReportesRecientes() {
  let query = supabaseClient.from('reportes_generados').select('*, planes(nombre)').order('created_at', { ascending: false }).limit(10);
  if (selectedReportPlanId) query = query.eq('plan_id', selectedReportPlanId);
  const { data } = await query;
  const container = document.getElementById('reportesRecientesList');
  if (!container) return;
  if (!data || data.length === 0) { container.innerHTML = '<p style="color:#94a3b8;font-size:0.8rem;">Aún no hay reportes generados.</p>'; return; }
  container.innerHTML = data.map(r => `
    <div class="reporte-reciente-card">
      <div class="reporte-reciente-icon" style="background:#EEEDFE;"><i class="bi bi-file-text" style="color:#534AB7;"></i></div>
      <div class="reporte-reciente-info">
        <div>${r.titulo || r.tipo_reporte}</div>
        <div class="reporte-reciente-meta">Generado el ${new Date(r.created_at).toLocaleDateString()} · ${r.planes?.nombre || '—'} · ${r.formato}</div>
      </div>
      <button class="btn-small btn-secondary" onclick="window.open('${r.archivo_url}','_blank')"><i class="bi bi-download"></i> Descargar</button>
    </div>`).join('');
}

// ==================== ALERTAS ====================

async function cargarAlertasConFiltros() {
  let query = supabaseClient.from('alertas').select('*, planes!inner(nombre)').order('fecha_creacion', { ascending: false });
  if (currentTabAlertas === 'critica') query = query.eq('tipo', 'kpi').eq('revisado', false);
  else if (currentTabAlertas === 'advertencia') query = query.eq('tipo', 'proyecto').eq('revisado', false);
  else if (currentTabAlertas === 'revisada') query = query.eq('revisado', true);

  const { data } = await query;
  const container = document.getElementById('alertasListContainer');
  if (!container) return;

  // Metrics
  const total = data?.length || 0;
  const sinRevisar = data?.filter(a => !a.revisado).length || 0;
  const criticas = data?.filter(a => a.tipo === 'kpi' && !a.revisado).length || 0;
  const advertencias = data?.filter(a => a.tipo === 'proyecto' && !a.revisado).length || 0;
  const informativas = data?.filter(a => a.tipo === 'iniciativa' && !a.revisado).length || 0;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const revisadasHoy = data?.filter(a => a.revisado && a.fecha_revision && new Date(a.fecha_revision) >= hoy).length || 0;

  document.getElementById('aCriticas').innerText = criticas;
  document.getElementById('aAdvertencias').innerText = advertencias;
  document.getElementById('aInformativas').innerText = informativas;
  document.getElementById('aRevisadasHoy').innerText = revisadasHoy;
  document.getElementById('alertasSubtitle').innerText = `${sinRevisar} sin revisar · Ordenadas por prioridad`;

  // Update alert tabs
  document.querySelectorAll('#alertasTabs .itab').forEach(tab => {
    const key = tab.getAttribute('data-tab');
    let count = 0;
    if (key === 'todas') count = total;
    else if (key === 'critica') count = criticas;
    else if (key === 'advertencia') count = advertencias;
    else if (key === 'revisada') count = data?.filter(a => a.revisado).length || 0;
    const labels = { todas: 'Todas', critica: 'Críticas', advertencia: 'Advertencias', revisada: 'Revisadas' };
    tab.innerText = `${labels[key]} (${count})`;
  });

  if (!data || data.length === 0) { container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:1.5rem;">No hay alertas que mostrar</div>'; return; }

  container.innerHTML = data.map(a => {
    let sevPill = 'pill-gray', sevLabel = 'Info', icoBg = '#E6F1FB', icoColor = '#0C447C', icoClass = 'bi-info-circle';
    if (a.tipo === 'kpi') { sevPill = 'pill-red'; sevLabel = 'Crítica'; icoBg = '#FCEBEB'; icoColor = '#791F1F'; icoClass = 'bi-graph-down'; }
    else if (a.tipo === 'proyecto') { sevPill = 'pill-amber'; sevLabel = 'Advertencia'; icoBg = '#FAEEDA'; icoColor = '#633806'; icoClass = 'bi-folder-x'; }

    let acciones = '';
    if (!a.revisado) {
      if (a.tipo === 'kpi') acciones = `<button class="btn-small btn-secondary" onclick="verResumenEjecutivo(${a.plan_id})">Ver plan</button><button class="btn-small btn-danger" onclick="abrirModalEscalar(${a.id},${a.plan_id})">Escalar</button><button class="btn-small btn-gray" onclick="marcarAlertaRevisada(${a.id})">Marcar revisada</button>`;
      else if (a.tipo === 'proyecto') acciones = `<button class="btn-small btn-secondary" onclick="verResumenEjecutivo(${a.plan_id})">Ver plan</button><button class="btn-small btn-gray" onclick="marcarAlertaRevisada(${a.id})">Marcar revisada</button>`;
      else acciones = `<button class="btn-small btn-primary" onclick="irAAprobar(${a.plan_id})">Ir a revisar</button>`;
    } else {
      acciones = `<span style="color:#22c55e;font-size:0.75rem;font-weight:600;"><i class="bi bi-check-circle-fill"></i> Revisada${a.comentario ? ': ' + a.comentario : ''}</span>`;
    }

    return `
    <div class="alert-item">
      <div class="alert-ico" style="background:${icoBg};"><i class="bi ${icoClass}" style="color:${icoColor};"></i></div>
      <div class="alert-body">
        <div class="alert-title">${a.descripcion}</div>
        <div class="alert-desc">Plan: ${a.planes?.nombre || '—'} · ${new Date(a.fecha_creacion).toLocaleString()}</div>
        <div class="alert-actions">${acciones}</div>
      </div>
      <span class="pill ${sevPill}" style="flex-shrink:0;align-self:flex-start;">${sevLabel}</span>
    </div>`;
  }).join('');
}

window.marcarAlertaRevisada = async function(id) {
  await supabaseClient.from('alertas').update({ revisado: true, revisado_por: currentUser.username, fecha_revision: new Date() }).eq('id', id);
  await cargarAlertasConFiltros();
  await actualizarBadges();
};

// ==================== ESCALAR ====================

function abrirModalEscalar(alertaId, planId) {
  document.getElementById('escalarPlanId').value = planId;
  document.getElementById('escalarMotivo').value = '';
  document.getElementById('escalarAlertaModal').style.display = 'flex';
  // Guardar el alerta ID en el hidden
  document.getElementById('escalarPlanId').setAttribute('data-alerta-id', alertaId);
}
window.abrirModalEscalar = abrirModalEscalar;

async function confirmarEscalar() {
  const planId = document.getElementById('escalarPlanId').value;
  const alertaId = document.getElementById('escalarPlanId').getAttribute('data-alerta-id');
  const motivo = document.getElementById('escalarMotivo').value.trim();

  const { data: plan } = await supabaseClient.from('planes').select('nombre, creado_por').eq('id', planId).single();
  if (!plan) { showToast('Plan no encontrado.', 'error'); return; }

  // Marcar alerta original
  await supabaseClient.from('alertas').update({ revisado: true, revisado_por: currentUser.username, fecha_revision: new Date(), comentario: `Escalado${motivo ? ': ' + motivo : ''}` }).eq('id', alertaId);

  // Crear nueva alerta para el Estratega
  await supabaseClient.from('alertas').insert({
    plan_id: planId,
    tipo: 'escalada',
    descripcion: `Alerta escalada del Aprobador: "${motivo || 'Se requiere atención urgente del Estratega.'}"`,
    revisado: false,
    destinatario_id: plan.creado_por
  });

  document.getElementById('escalarAlertaModal').style.display = 'none';
  showToast('Alerta escalada al Estratega.', 'success');
  await cargarAlertasConFiltros();
  await actualizarBadges();
}
