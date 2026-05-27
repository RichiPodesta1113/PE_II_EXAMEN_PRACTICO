
// Configuración de Supabase
const SUPABASE_URL = 'https://ssdphnukjtjqageqfyeu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_eb5lIWekDOh8Osk9IGydGA_Jw1MktBZ';
console.log("2. Credenciales de Supabase definidas.");

// Usamos un nombre diferente para la variable
let supabaseClient;
try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("3. Cliente de Supabase creado exitosamente.");
} catch (error) {
    console.error("❌ Error al crear cliente Supabase:", error);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("4. DOM completamente cargado.");
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const roleBtns = document.querySelectorAll('.role-btn');
    const loginForm = document.getElementById('loginForm');

    console.log("5. Elementos del formulario encontrados:", { 
        username: !!usernameInput, 
        password: !!passwordInput,
        botones: roleBtns.length,
        form: !!loginForm
    });

    if (!usernameInput || !passwordInput || !loginForm) {
        console.error("❌ No se encontraron los campos del formulario. Verifica los IDs en HTML.");
        return;
    }

    function fillCredentials(username, password) {
        console.log(`Rellenando credenciales: usuario=${username}, pass=${password}`);
        usernameInput.value = username;
        passwordInput.value = password;
        showToast(`Rol seleccionado: ${username}`, 'info');
    }

    roleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const username = btn.getAttribute('data-email');
            const password = btn.getAttribute('data-password');
            console.log(`Botón de rol clickeado: ${username}`);
            if (username && password) {
                fillCredentials(username, password);
                roleBtns.forEach(b => b.classList.remove('active-preview'));
                btn.classList.add('active-preview');
            } else {
                console.warn("Botón sin atributos data-email o data-password", btn);
            }
        });
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log("6. Formulario enviado (preventDefault ejecutado).");

        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            console.warn("Campos vacíos");
            showToast('Complete todos los campos', 'error');
            return;
        }

        console.log(`7. Intentando login con usuario: ${username}`);
        const email = `${username}@contaperu.pe`;
        console.log(`   Email construido: ${email}`);

        if (!supabaseClient) {
            console.error("❌ Cliente de Supabase no disponible");
            showToast('Error de conexión con el servidor', 'error');
            return;
        }

        try {
            console.log("8. Llamando a supabaseClient.auth.signInWithPassword...");
            const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (authError) {
                console.error("❌ Error de autenticación:", authError);
                showToast('Usuario o contraseña incorrectos', 'error');
                return;
            }
            console.log("✅ Autenticación exitosa", authData.user.email);

            console.log("9. Consultando rol en tabla usuarios...");
            const { data: userData, error: userError } = await supabaseClient
                .from('usuarios')
                .select('rol')
                .eq('email', email)
                .maybeSingle();

            if (userError || !userData) {
                console.error("❌ Error al obtener rol:", userError);
                showToast('Error al obtener el rol. Contacte al administrador.', 'error');
                await supabaseClient.auth.signOut();
                return;
            }

            const role = userData.rol;
            console.log(`✅ Rol obtenido: ${role}`);

            localStorage.setItem('peti_session', JSON.stringify({
                username: username,
                role: role,
                access_token: authData.session?.access_token,
                user_id: authData.user?.id
            }));

            showToast(`✅ Bienvenido, ${username}`, 'success');

            const redirectMap = {
                'administrador': 'html/Admin-Panel.html',
                'estratega': 'html/Estratega-Panel.html',
                'lider': 'html/LideresArea-Panel.html',
                'operativo': 'html/EquipoOperativo-Panel.html',
                'aprobador': 'html/Aprobador-Panel.html'  
            };
            const redirectUrl = redirectMap[role];
            if (redirectUrl) {
                console.log(`10. Redirigiendo a: ${redirectUrl}`);
                window.location.href = redirectUrl;
            } else {
                console.warn(`Rol no reconocido: ${role}`);
                showToast('Rol no reconocido', 'error');
            }

        } catch (error) {
            console.error("❌ Error general en el login:", error);
            showToast('Error de conexión con el servidor', 'error');
        }
    });

    function showToast(message, type = 'info') {
        const existingToast = document.querySelector('.peti-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = `peti-toast toast-${type}`;
        toast.innerHTML = `<div class="toast-content"><i class="fas ${type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-info-circle')}"></i><span>${message}</span></div>`;
        document.body.appendChild(toast);

        if (!document.getElementById('toast-styles')) {
            const toastStyle = document.createElement('style');
            toastStyle.id = 'toast-styles';
            toastStyle.textContent = `
                .peti-toast { position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%); background: #0f172a; backdrop-filter: blur(12px); border: 1px solid #334155; border-radius: 3rem; padding: 0.7rem 1.5rem; z-index: 2000; animation: slideUp 0.25s ease; box-shadow: 0 10px 20px -5px rgba(0,0,0,0.3); }
                .toast-content { display: flex; align-items: center; gap: 0.7rem; color: white; font-size: 0.85rem; font-weight: 500; }
                .toast-success i { color: #22c55e; } .toast-error i { color: #f97316; } .toast-info i { color: #3b82f6; }
                @keyframes slideUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
            `;
            document.head.appendChild(toastStyle);
        }
        setTimeout(() => toast.remove(), 3500);
    }
});