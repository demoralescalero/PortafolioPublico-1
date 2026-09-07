const firebaseConfig = {
    apiKey: "AIzaSyA7JYz_dbz2XyGFhNigvWE00gAIuEm-qgU",
    authDomain: "base-de-gestion-de-cuentas.firebaseapp.com",
    projectId: "base-de-gestion-de-cuentas",
    storageBucket: "base-de-gestion-de-cuentas.firebasestorage.app",
    messagingSenderId: "853174624809",
    appId: "1:853174624809:web:88cf71cd992a8c2ec23238"
};

if (typeof firebase === 'undefined') {
    throw new Error('Firebase no se cargó. Revisa el orden de los SDK en index.html.');
}

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

let usuarioActual = null;
let rolActual = 'lector';
let cuentasRef = null;
let unsubscribeCuentas = null;
let allAccounts = [];
let currentAccountData = null;

const modalRegistro = document.getElementById('modal-registro');
const modalAcciones = document.getElementById('modal-acciones');
const formRegistro = document.getElementById('form-registro');
const tbody = document.getElementById('accounts-body');

const loginScreen = document.getElementById('login-screen');
const loadingScreen = document.getElementById('loading-screen');
const app = document.getElementById('app');
const userBar = document.getElementById('user-bar');
const userEmail = document.getElementById('user-email');
const loginError = document.getElementById('login-error');
const btnLoginGoogle = document.getElementById('btn-login-google');
const btnLogout = document.getElementById('btn-logout');

const puedeCrearCuentas = () => {
    return ['admin', 'operador'].includes(rolActual);
};

const puedeRenovarCuentas = () => {
    return ['admin', 'operador'].includes(rolActual);
};

const puedeEliminarCuentas = () => {
    return rolActual === 'admin';
};

const aplicarPermisosEnInterfaz = () => {
    const puedeCrear = puedeCrearCuentas();
    const puedeRenovar = puedeRenovarCuentas();
    const puedeEliminar = puedeEliminarCuentas();

    document.getElementById('btn-agregar-usuario').hidden = !puedeCrear;

    document.querySelectorAll('.btn-add-time').forEach((btn) => {
        btn.hidden = !puedeRenovar;
    });

    document.getElementById('btn-delete-user').hidden = !puedeEliminar;
};

const calcularFechaVencimiento = (fechaInicio, meses) => {
    const vencimiento = new Date(fechaInicio);
    vencimiento.setMonth(vencimiento.getMonth() + Number(meses));
    return vencimiento;
};

const convertirFechaLocal = (fechaTexto) => {
    const [anio, mes, dia] = fechaTexto.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
};

const obtenerDate = (valor) => {
    if (valor instanceof firebase.firestore.Timestamp) {
        return valor.toDate();
    }

    return new Date(valor);
};

const formatearFecha = (fecha) => {
    if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
        return 'N/A';
    }

    return fecha.toLocaleDateString('es-PE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
};

const calcularVencimiento = (fechaInicio, fechaVencimiento, duracionMeses) => {
    const inicio = obtenerDate(fechaInicio);

    if (Number.isNaN(inicio.getTime())) {
        return {
            dias: -999,
            estado: 'Error',
            vencimiento: 'Fecha inválida'
        };
    }

    let vencimiento = obtenerDate(fechaVencimiento);

    if (Number.isNaN(vencimiento.getTime())) {
        vencimiento = calcularFechaVencimiento(inicio, duracionMeses);
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    vencimiento.setHours(0, 0, 0, 0);

    const diferenciaTiempo = vencimiento.getTime() - hoy.getTime();
    const dias = Math.ceil(diferenciaTiempo / (1000 * 60 * 60 * 24));

    let estado = 'Activo';

    if (dias < 0) {
        estado = 'Vencido';
    } else if (dias <= 5) {
        estado = 'Por Vencer';
    }

    return {
        dias,
        estado,
        vencimiento: formatearFecha(vencimiento)
    };
};

const limpiarTablaYContadores = () => {
    tbody.innerHTML = '';

    document.getElementById('total-cuentas').textContent = '0';
    document.getElementById('activas-cuentas').textContent = '0';
    document.getElementById('por-vencer-cuentas').textContent = '0';
    document.getElementById('vencidas-cuentas').textContent = '0';
};

const cerrarModales = () => {
    modalRegistro.style.display = 'none';
    modalAcciones.style.display = 'none';
};

const mostrarCargando = () => {
    loadingScreen.hidden = false;
    loginScreen.hidden = true;
    app.hidden = true;
    userBar.hidden = true;
};

const mostrarLogin = () => {
    loadingScreen.hidden = true;
    loginScreen.hidden = false;
    app.hidden = true;
    userBar.hidden = true;

    cerrarModales();
    limpiarTablaYContadores();
};

const mostrarApp = (usuario) => {
    loadingScreen.hidden = true;
    loginScreen.hidden = true;
    app.hidden = false;
    userBar.hidden = false;

    userEmail.textContent = usuario.email || 'Usuario autenticado';
};

const crearPerfilSiNoExiste = async (usuario) => {
    const perfilRef = db.collection('usuarios').doc(usuario.uid);
    const perfil = await perfilRef.get();

    if (!perfil.exists) {
        await perfilRef.set({
            uid: usuario.uid,
            email: usuario.email || '',
            nombre: usuario.displayName || '',
            rol: 'lector',
            creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
            actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });

        return 'lector';
    }

    const datos = perfil.data();

    return datos.rol || 'lector';
};

const escaparHtml = (texto = '') => {
    return String(texto)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
};

const renderizarFila = (data) => {
    const { dias, estado, vencimiento } = calcularVencimiento(
        data.fecha_inicio,
        data.fecha_vencimiento,
        data.plan_meses
    );

    const inicioDate = obtenerDate(data.fecha_inicio);
    const inicioDisplay = formatearFecha(inicioDate);

    const diasRestantesTexto = dias > 0
        ? `${dias} días`
        : (dias === 0 ? 'HOY' : 'VENCIDO');

    const estadoClass = estado.replace(/\s/g, '');

    const row = document.createElement('tr');
    row.dataset.id = data.firebaseId;

    row.innerHTML = `
        <td>${escaparHtml(data.id)}</td>
        <td>${escaparHtml(data.email)}</td>
        <td>${Number(data.plan_meses)} meses</td>
        <td>${inicioDisplay}</td>
        <td>${vencimiento}</td>
        <td>${diasRestantesTexto}</td>
        <td>
            <span class="status-badge status-${estadoClass}">
                ${estado}
            </span>
        </td>
        <td>
            <button class="details-btn" type="button">
                Ver detalles
            </button>
        </td>
    `;

    row.querySelector('.details-btn').addEventListener('click', () => {
        openAccionesModal(data);
    });

    return row;
};

const applyFilters = () => {
    const searchTerm = document.getElementById('search-input').value.trim().toLowerCase();
    const planFilter = document.getElementById('filter-plan').value;
    const estadoFilter = document.getElementById('filter-estado').value;

    tbody.innerHTML = '';

    let total = 0;
    let activas = 0;
    let porVencer = 0;
    let vencidas = 0;

    const filteredAccounts = allAccounts.filter((account) => {
        const { estado } = calcularVencimiento(
            account.fecha_inicio,
            account.fecha_vencimiento,
            account.plan_meses
        );

        const id = String(account.id || '').toLowerCase();
        const email = String(account.email || '').toLowerCase();

        const matchesSearch =
            id.includes(searchTerm) ||
            email.includes(searchTerm);

        const matchesPlan =
            planFilter === '' ||
            String(account.plan_meses) === planFilter;

        const matchesEstado =
            estadoFilter === '' ||
            estado === estadoFilter;

        if (!matchesSearch || !matchesPlan || !matchesEstado) {
            return false;
        }

        total += 1;

        if (estado === 'Activo') {
            activas += 1;
        } else if (estado === 'Por Vencer') {
            porVencer += 1;
        } else if (estado === 'Vencido') {
            vencidas += 1;
        }

        return true;
    });

    filteredAccounts.forEach((account) => {
        tbody.appendChild(renderizarFila(account));
    });

    document.getElementById('total-cuentas').textContent = total;
    document.getElementById('activas-cuentas').textContent = activas;
    document.getElementById('por-vencer-cuentas').textContent = porVencer;
    document.getElementById('vencidas-cuentas').textContent = vencidas;
};

const cargarCuentas = () => {
    if (!cuentasRef) {
        return;
    }

    if (unsubscribeCuentas) {
        unsubscribeCuentas();
    }

    unsubscribeCuentas = cuentasRef.onSnapshot((snapshot) => {
        allAccounts = snapshot.docs.map((doc) => ({
            firebaseId: doc.id,
            ...doc.data()
        }));

        applyFilters();
    }, (error) => {
        console.error('Error de Firestore:', error.code, error.message);

        if (error.code === 'permission-denied') {
            alert('No tienes permiso para acceder a estas cuentas. Revisa las reglas de Firestore.');
        } else {
            alert('No se pudo cargar la base de datos. Revisa la consola.');
        }
    });
};

const agregarCuenta = async (data) => {
    if (!puedeCrearCuentas()) {
        alert('No tienes permiso para crear cuentas.');
        return;
    }

    if (!usuarioActual || !cuentasRef) {
        alert('Debes iniciar sesión antes de registrar una cuenta.');
        return;
    }

    const id = data.id.trim();
    const email = data.email.trim().toLowerCase();
    const meses = Number(data.plan_meses);

    if (!id || !email || !data.fecha_inicio || ![3, 6, 12].includes(meses)) {
        alert('Completa correctamente todos los campos.');
        return;
    }

    const existeId = allAccounts.some((cuenta) => {
        return String(cuenta.id || '').trim().toLowerCase() === id.toLowerCase();
    });

    if (existeId) {
        alert('Ya existe una cuenta con ese ID en tu espacio.');
        return;
    }

    const fechaInicio = convertirFechaLocal(data.fecha_inicio);
    const fechaVencimiento = calcularFechaVencimiento(fechaInicio, meses);

    try {
        await cuentasRef.add({
            id,
            email,
            ownerId: usuarioActual.uid,
            fecha_inicio: firebase.firestore.Timestamp.fromDate(fechaInicio),
            fecha_vencimiento: firebase.firestore.Timestamp.fromDate(fechaVencimiento),
            plan_meses: meses,
            creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
            creadoPor: usuarioActual.uid,
            actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
            actualizadoPor: usuarioActual.uid
        });

        alert('✅ Cuenta registrada con éxito.');
        formRegistro.reset();
        modalRegistro.style.display = 'none';
    } catch (error) {
        console.error('Error al guardar cuenta:', error);
        alert('No se pudo guardar la cuenta. Revisa tus permisos y la consola.');
    }
};

const eliminarCuenta = async (firebaseId) => {
    if (!puedeEliminarCuentas()) {
        alert('No tienes permiso para eliminar cuentas.');
        return;
    }

    if (!cuentasRef || !usuarioActual) {
        return;
    }

    try {
        await cuentasRef.doc(firebaseId).delete();
        modalAcciones.style.display = 'none';
        alert('Cuenta eliminada con éxito.');
    } catch (error) {
        console.error('Error al eliminar cuenta:', error);
        alert('No se pudo eliminar la cuenta.');
    }
};

const agregarTiempo = async (firebaseId, mesesAAgregar) => {
    if (!puedeRenovarCuentas()) {
        alert('No tienes permiso para renovar cuentas.');
        return;
    }

    if (!cuentasRef || !usuarioActual) {
        return;
    }

    const meses = Number(mesesAAgregar);

    if (![3, 6, 12].includes(meses)) {
        alert('El periodo de renovación no es válido.');
        return;
    }

    try {
        const docRef = cuentasRef.doc(firebaseId);
        const doc = await docRef.get();

        if (!doc.exists) {
            alert('Cuenta no encontrada.');
            return;
        }

        const data = doc.data();
        const fechaInicio = obtenerDate(data.fecha_inicio);

        let vencimientoActual = obtenerDate(data.fecha_vencimiento);

        if (Number.isNaN(vencimientoActual.getTime())) {
            vencimientoActual = calcularFechaVencimiento(
                fechaInicio,
                Number(data.plan_meses)
            );
        }

        const nuevaFechaVencimiento = new Date(vencimientoActual);
        nuevaFechaVencimiento.setMonth(
            nuevaFechaVencimiento.getMonth() + meses
        );

        await docRef.update({
            fecha_vencimiento: firebase.firestore.Timestamp.fromDate(nuevaFechaVencimiento),
            actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
            actualizadoPor: usuarioActual.uid
        });

        modalAcciones.style.display = 'none';
        alert(`✅ Se agregaron ${meses} meses a la cuenta.`);
    } catch (error) {
        console.error('Error al agregar tiempo:', error);
        alert('No se pudo extender la cuenta. Revisa la consola.');
    }
};

const openAccionesModal = (accountData) => {
    currentAccountData = accountData;

    document.getElementById('acciones-account-info').textContent =
        `${accountData.id} - ${accountData.email}`;

    aplicarPermisosEnInterfaz();
    modalAcciones.style.display = 'block';
};

const iniciarSesionConGoogle = async () => {
    loginError.textContent = '';
    btnLoginGoogle.disabled = true;
    btnLoginGoogle.textContent = 'Abriendo Google...';

    try {
        await auth.signInWithPopup(provider);
    } catch (error) {
        console.error('Error al iniciar sesión:', error);

        if (error.code === 'auth/popup-closed-by-user') {
            loginError.textContent = 'Cerraste la ventana de inicio de sesión.';
        } else if (error.code === 'auth/unauthorized-domain') {
            loginError.textContent = 'Este dominio no está autorizado en Firebase Authentication.';
        } else {
            loginError.textContent = 'No se pudo iniciar sesión. Inténtalo nuevamente.';
        }
    } finally {
        btnLoginGoogle.disabled = false;
        btnLoginGoogle.textContent = 'Iniciar sesión con Google';
    }
};

const cerrarSesion = async () => {
    try {
        await auth.signOut();
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        alert('No se pudo cerrar sesión.');
    }
};

const inicializarEventos = () => {
    document.getElementById('search-input').addEventListener('input', applyFilters);
    document.getElementById('filter-plan').addEventListener('change', applyFilters);
    document.getElementById('filter-estado').addEventListener('change', applyFilters);

    document.getElementById('btn-agregar-usuario').addEventListener('click', () => {
        if (!puedeCrearCuentas()) {
            alert('No tienes permiso para crear cuentas.');
            return;
        }

        modalRegistro.style.display = 'block';
    });

    btnLoginGoogle.addEventListener('click', iniciarSesionConGoogle);
    btnLogout.addEventListener('click', cerrarSesion);

    document.querySelectorAll('.close-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            const modal = event.currentTarget.closest('.modal');
            modal.style.display = 'none';
        });
    });

    window.addEventListener('click', (event) => {
        if (event.target === modalRegistro) {
            modalRegistro.style.display = 'none';
        }

        if (event.target === modalAcciones) {
            modalAcciones.style.display = 'none';
        }
    });

    formRegistro.addEventListener('submit', (event) => {
        event.preventDefault();

        agregarCuenta({
            id: document.getElementById('reg-id').value,
            email: document.getElementById('reg-email').value,
            fecha_inicio: document.getElementById('reg-fecha').value,
            plan_meses: document.getElementById('reg-plan').value
        });
    });

    document.querySelectorAll('.btn-add-time').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!currentAccountData) {
                return;
            }

            agregarTiempo(
                currentAccountData.firebaseId,
                btn.dataset.meses
            );
        });
    });

    document.getElementById('btn-delete-user').addEventListener('click', () => {
        if (!puedeEliminarCuentas()) {
            alert('No tienes permiso para eliminar cuentas.');
            return;
        }

        if (!currentAccountData) {
            return;
        }

        const confirmacion = confirm(
            `¿Estás seguro de eliminar la cuenta ${currentAccountData.id}? Esta acción es irreversible.`
        );

        if (confirmacion) {
            eliminarCuenta(currentAccountData.firebaseId);
        }
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    mostrarCargando();
    inicializarEventos();

    try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

        auth.onAuthStateChanged(async (usuario) => {
            if (unsubscribeCuentas) {
                unsubscribeCuentas();
                unsubscribeCuentas = null;
            }

            allAccounts = [];
            currentAccountData = null;

            if (!usuario) {
                usuarioActual = null;
                rolActual = 'lector';
                cuentasRef = null;
                mostrarLogin();
                return;
            }

            try {
                usuarioActual = usuario;
                rolActual = await crearPerfilSiNoExiste(usuario);

                cuentasRef = db
                    .collection('usuarios')
                    .doc(usuario.uid)
                    .collection('cuentas');

                mostrarApp(usuario);
                aplicarPermisosEnInterfaz();
                cargarCuentas();
            } catch (error) {
                console.error('Error al preparar la sesión:', error);
                loginError.textContent =
                    'La sesión inició, pero no se pudo preparar tu espacio privado.';

                await auth.signOut();
            }
        });
    } catch (error) {
        console.error('No se pudo configurar la persistencia:', error);
        mostrarLogin();
    }
});
