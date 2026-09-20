'use client';

// Interface strings in English and Spanish.
//
// Switching language changes the whole app — navigation, page titles, buttons,
// empty states, Ori and support — not just the accessibility panel. Money
// amounts, merchant names and people's names are never translated.

import { useAccessibility } from '@/lib/accessibility';

const STRINGS = {
  // --- navigation ---
  'nav.home': ['Home', 'Inicio'],
  'nav.accounts': ['Accounts', 'Cuentas'],
  'nav.cards': ['Cards', 'Tarjetas'],
  'nav.pay': ['Pay', 'Pagar'],
  'nav.spending': ['Spending', 'Gastos'],
  'nav.budget': ['Budget', 'Presupuesto'],
  'nav.invest': ['Invest', 'Invertir'],
  'nav.rewards': ['Rewards', 'Recompensas'],
  'nav.subscriptions': ['Subscriptions', 'Suscripciones'],
  'nav.plans': ['Pay Over Time', 'Pagos a plazos'],
  'nav.credit': ['Credit', 'Crédito'],
  'nav.travel': ['Travel', 'Viajes'],
  'nav.split': ['Split a bill', 'Dividir cuenta'],
  'nav.alerts': ['Alerts', 'Alertas'],
  'nav.support': ['Help', 'Ayuda'],
  'nav.accessibility': ['Accessibility', 'Accesibilidad'],
  'nav.settings': ['Settings', 'Ajustes'],
  'nav.transfer': ['Transfer money', 'Transferir'],
  'nav.more': ['More', 'Más'],
  'nav.moreHint': ['Drag down or tap outside to close', 'Desliza hacia abajo o toca fuera para cerrar'],
  'nav.group.money': ['Your money', 'Tu dinero'],
  'nav.group.understand': ['Understand', 'Entiende'],
  'nav.group.grow': ['Grow', 'Crece'],
  'nav.group.keepUp': ['Keep up', 'Al día'],
  'nav.collapse': ['Collapse menu', 'Contraer menú'],
  'nav.expand': ['Expand menu', 'Expandir menú'],
  'nav.skip': ['Skip to main content', 'Ir al contenido'],

  // --- greetings and dashboard ---
  'greet.morning': ['Good morning', 'Buenos días'],
  'greet.afternoon': ['Good afternoon', 'Buenas tardes'],
  'greet.evening': ['Good evening', 'Buenas noches'],
  'home.available': ['Available balance', 'Saldo disponible'],
  'home.availableHint': ['In checking, ready to spend', 'En tu cuenta, listo para usar'],
  'home.committed': ['Already committed', 'Ya comprometido'],
  'home.committedHint': ['Bills and subscriptions before payday', 'Pagos antes de tu próximo sueldo'],
  'home.free': ['Free to spend', 'Libre para gastar'],
  'home.send': ['Send', 'Enviar'],
  'home.request': ['Request', 'Solicitar'],
  'home.deposit': ['Deposit', 'Depositar'],
  'home.move': ['Move money', 'Mover dinero'],
  'home.yourCards': ['Your cards', 'Tus tarjetas'],
  'home.coming': ['Coming up', 'Próximamente'],
  'home.needsYou': ['Needs you', 'Requiere tu atención'],
  'home.seeAll': ['See all', 'Ver todo'],
  'home.points': ['Points', 'Puntos'],
  'home.portfolio': ['Investments', 'Inversiones'],

  // --- page headers ---
  'page.accounts.title': ['Accounts', 'Cuentas'],
  'page.cards.title': ['Your cards', 'Tus tarjetas'],
  'page.cards.subtitle': ['What you carry, what it earns, and what you could move up to.', 'Lo que llevas, lo que ganas y a qué puedes subir.'],
  'page.pay.title': ['Pay & request', 'Pagar y solicitar'],
  'page.pay.subtitle': ['Send money, pay a bill, or deposit a cheque with your camera.', 'Envía dinero, paga una factura o deposita un cheque con tu cámara.'],
  'page.spending.title': ['Where your money went', '¿En qué se fue tu dinero?'],
  'page.budget.title': ['Your plan', 'Tu plan'],
  'page.budget.subtitle': ['What comes in, what goes out, and whether you will be fine.', 'Lo que entra, lo que sale, y si vas a estar bien.'],
  'page.invest.title': ['Invest', 'Invertir'],
  'page.invest.subtitle': ['Put money to work, starting from $1. Fractional shares and crypto.', 'Pon tu dinero a trabajar desde $1. Acciones fraccionadas y cripto.'],
  'page.rewards.title': ['Rewards', 'Recompensas'],
  'page.rewards.subtitle': ['100 points = $1. Always. Here is what yours are worth.', '100 puntos = $1, siempre. Esto es lo que valen los tuyos.'],
  'page.subscriptions.title': ['Subscriptions', 'Suscripciones'],
  'page.alerts.title': ['Alerts', 'Alertas'],
  'page.settings.title': ['Settings', 'Ajustes'],
  'page.accounts.heading': ['Your money', 'Tu dinero'],
  'page.accounts.subtitle': ['Every account in one place, with what is really available.', 'Todas tus cuentas en un lugar, con lo que hay disponible.'],
  'page.subscriptions.heading': ['Everything charging you on repeat', 'Todo lo que te cobra sin parar'],
  'page.subscriptions.subtitle': ['Found automatically from your card purchases. Turn on Guard to be asked before a charge, or block a merchant outright.', 'Detectadas de tus compras. Activa Guard para que te preguntemos antes de cada cobro, o bloquea el comercio.'],
  'page.plans.heading': ['My plans', 'Mis planes'],
  'page.plans.subtitle': ['Purchases you have split into monthly payments.', 'Compras divididas en pagos mensuales.'],
  'page.alerts.heading': ['Notifications', 'Notificaciones'],
  'page.alerts.subtitle': ['Charges waiting on you, and anything Orbit spotted.', 'Cobros que esperan tu decisión y lo que Orbit detectó.'],
  'page.travel.heading': ['Book it here, earn more, pay less', 'Reserva aquí, gana más, paga menos'],
  'page.travel.subtitle': ['Flights and hotels right in the app — no separate website, no second sign-in.', 'Vuelos y hoteles en la app, sin otra web ni otro inicio de sesión.'],
  'page.split.heading': ['Who owes what', '¿Quién debe qué?'],
  'page.split.subtitle': ['Scan a receipt and we split it fairly — you pay for what you had, and tax and tip follow each share.', 'Escanea el recibo y lo dividimos con justicia: pagas lo tuyo, y los impuestos y la propina siguen tu parte.'],
  'page.support.heading': ['Talk to a real person', 'Habla con una persona real'],
  'page.support.subtitle': ['Any time, day or night. No phone trees. Whoever helps you sees what you already told Ori.', 'A cualquier hora. Sin menús telefónicos. Quien te atienda ya verá lo que le contaste a Ori.'],
  'page.credit.heading': ['Your credit score', 'Tu puntaje de crédito'],
  'page.spending.subtitle': ['Every card purchase and withdrawal, grouped so you can see your habits.', 'Cada compra y retiro, agrupados para ver tus hábitos.'],

  // --- Ori ---
  'ori.open': ['Ask Ori', 'Pregunta a Ori'],
  'ori.title': ['Ori', 'Ori'],
  'ori.subtitle': ['Your money, explained', 'Tu dinero, explicado'],
  'ori.new': ['New chat', 'Chat nuevo'],
  'ori.placeholder': ['Ask me anything…', 'Pregúntame lo que sea…'],
  'ori.send': ['Send', 'Enviar'],
  'ori.listen': ['Speak your question', 'Habla tu pregunta'],
  'ori.listening': ['Listening…', 'Escuchando…'],
  'ori.readAloud': ['Read answers aloud', 'Leer respuestas'],
  'ori.human': ['Talk to a human', 'Hablar con una persona'],
  'ori.close': ['Close', 'Cerrar'],
  'ori.expand': ['Make this bigger', 'Hacerlo más grande'],
  'ori.shrink': ['Make this smaller', 'Hacerlo más pequeño'],

  // --- accessibility quick panel ---
  'a11y.quick': ['Display', 'Pantalla'],
  'a11y.textSize': ['Text size', 'Tamaño de letra'],
  'a11y.contrast': ['High contrast', 'Alto contraste'],
  'a11y.simple': ['Simple mode', 'Modo simple'],
  'a11y.readPage': ['Read this page aloud', 'Leer esta página'],
  'a11y.stop': ['Stop reading', 'Detener'],
  'a11y.all': ['All accessibility settings', 'Todas las opciones'],
  'a11y.theme': ['Appearance', 'Apariencia'],
  'a11y.light': ['Light', 'Claro'],
  'a11y.dark': ['Dark', 'Oscuro'],
  'a11y.system': ['System', 'Sistema'],

  // --- common ---
  'common.back': ['Back', 'Atrás'],
  'common.close': ['Close', 'Cerrar'],
  'common.cancel': ['Cancel', 'Cancelar'],
  'common.confirm': ['Confirm', 'Confirmar'],
  'common.continue': ['Continue', 'Continuar'],
  'common.save': ['Save', 'Guardar'],
  'common.done': ['Done', 'Listo'],
  'common.signOut': ['Sign out', 'Cerrar sesión'],
  'common.loading': ['Loading…', 'Cargando…'],
  'common.today': ['Today', 'Hoy'],
  'common.amount': ['Amount', 'Cantidad'],
  'common.from': ['From', 'Desde'],
  'common.to': ['To', 'Para'],
  'common.note': ['Note', 'Nota'],
  'common.date': ['Date', 'Fecha'],
  'common.repeat': ['Repeat', 'Repetir'],

  // --- session timeout ---
  'idle.title': ['Are you still there?', '¿Sigues ahí?'],
  'idle.body': ['For your security we’ll sign you out soon.', 'Por tu seguridad cerraremos la sesión pronto.'],
  'idle.stay': ['I’m still here', 'Sigo aquí'],
} as const;

export type StringKey = keyof typeof STRINGS;

export function translate(key: StringKey, lang: 'en' | 'es'): string {
  return STRINGS[key][lang === 'es' ? 1 : 0];
}

export function useT(): (key: StringKey) => string {
  const { settings } = useAccessibility();
  return (key) => translate(key, settings.language);
}

/** The greeting that matches the time of day. */
export function greetingKey(date = new Date()): StringKey {
  const hour = date.getHours();
  if (hour < 12) return 'greet.morning';
  if (hour < 18) return 'greet.afternoon';
  return 'greet.evening';
}
