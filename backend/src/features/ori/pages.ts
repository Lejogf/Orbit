// Plain-language explanations of every screen, for "what is this page?".
//
// Written for someone who has never used a banking app: short sentences, no
// jargon, and always "what you can do here" rather than a feature list.

export interface PageGuide {
  title: string;
  what: string;
  canDo: string[];
  es: { title: string; what: string };
}

const GUIDES: [string, PageGuide][] = [
  ['/dashboard', {
    title: 'Home',
    what: 'Home shows the money that is really free to use. "Safe to Spend" is your checking balance minus the bills and subscriptions that will come out before your next paycheck.',
    canDo: ['See what is safe to spend until payday', 'See what is coming out soon', 'Open any alert that needs you'],
    es: { title: 'Inicio', what: 'Inicio muestra el dinero que realmente puedes usar: tu saldo menos los pagos que saldrán antes de tu próximo sueldo.' },
  }],
  ['/accounts', {
    title: 'Accounts',
    what: 'All your accounts in one list: checking, savings and your credit card, with the balance of each.',
    canDo: ['Open an account to see every transaction', 'Search for a purchase', 'Lock or unlock your card'],
    es: { title: 'Cuentas', what: 'Todas tus cuentas en una lista, con el saldo de cada una.' },
  }],
  ['/spending', {
    title: 'Spending',
    what: 'Where your money went this month, sorted by category, and how that compares with last month.',
    canDo: ['See your biggest categories', 'Compare with last month', 'Read tips about your habits'],
    es: { title: 'Gastos', what: 'En qué gastaste este mes, por categoría, comparado con el mes pasado.' },
  }],
  ['/subscriptions', {
    title: 'Subscriptions',
    what: 'Every service that charges you again and again — streaming, gym, apps. We found them from your card history.',
    canDo: ['Block a subscription', 'Turn on "Ask me first" so we check with you before each charge', 'Get a reminder before it renews'],
    es: { title: 'Suscripciones', what: 'Cada servicio que te cobra repetidamente. Puedes bloquearlo o pedir que te preguntemos antes de cada cobro.' },
  }],
  ['/plans', {
    title: 'Pay Over Time',
    what: 'Big card purchases you have split into monthly payments, how much is left, and when each is paid off.',
    canDo: ['See what you still owe on each plan', 'Make the next payment', 'Pay a plan off early'],
    es: { title: 'Pagos a plazos', what: 'Compras grandes divididas en pagos mensuales, y cuánto falta por pagar.' },
  }],
  ['/credit', {
    title: 'Credit',
    what: 'An estimate of your credit score using the same five factors FICO uses, and what would move it up or down.',
    canDo: ['See what helps and hurts your score', 'Try "what if" changes before you make them'],
    es: { title: 'Crédito', what: 'Un estimado de tu puntaje de crédito y qué lo haría subir o bajar.' },
  }],
  ['/travel', {
    title: 'Travel & Rewards',
    what: 'Book flights and hotels right here, see if prices are likely to go up or down, and use your miles in the smartest way.',
    canDo: ['Search and book a flight or hotel', 'Turn on offers for places you already shop', 'See the best way to pay with miles'],
    es: { title: 'Viajes y recompensas', what: 'Reserva vuelos y hoteles aquí y usa tus millas de la mejor manera.' },
  }],
  ['/split', {
    title: 'Split a bill',
    what: 'Take a photo of a receipt and we will work out who owes what, including tax and tip, then send requests to your friends.',
    canDo: ['Scan a receipt', 'Split a card purchase evenly', 'Send payment requests'],
    es: { title: 'Dividir una cuenta', what: 'Toma una foto del recibo y calculamos cuánto debe cada persona.' },
  }],
  ['/alerts', {
    title: 'Alerts',
    what: 'Every notification we have sent you, kept here even after the pop-up disappears — including every card charge.',
    canDo: ['Approve or keep blocking a charge', 'See every charge alert', 'Test that alerts reach your phone'],
    es: { title: 'Alertas', what: 'Todas las notificaciones, guardadas aquí aunque desaparezca el aviso.' },
  }],
  ['/transfer', {
    title: 'Transfer',
    what: 'Move money between your own accounts, or pay your credit card from checking.',
    canDo: ['Move money to savings', 'Pay your card'],
    es: { title: 'Transferir', what: 'Mueve dinero entre tus cuentas o paga tu tarjeta.' },
  }],
  ['/settings/accessibility', {
    title: 'Accessibility',
    what: 'Make the app easier to see, read and use: bigger text, stronger contrast, simpler screens, reading aloud, and more.',
    canDo: ['Make text bigger', 'Turn on Simple mode', 'Have pages read aloud'],
    es: { title: 'Accesibilidad', what: 'Haz la app más fácil de ver y usar: letra más grande, más contraste y pantallas más simples.' },
  }],
  ['/settings', {
    title: 'Settings',
    what: 'Your personal details, security and notifications. You can update your address, request a legal name change, and add a trusted contact.',
    canDo: ['Change your address', 'Request a name change', 'Change your password or username'],
    es: { title: 'Ajustes', what: 'Tus datos, seguridad y notificaciones. Puedes cambiar tu dirección o solicitar un cambio de nombre.' },
  }],
  ['/support', {
    title: 'Help & Support',
    what: 'Talk to a real person, any time of day: live chat, a phone call, or we call you back.',
    canDo: ['Chat live with an agent', 'Call us without re-verifying', 'Schedule a callback'],
    es: { title: 'Ayuda', what: 'Habla con una persona real a cualquier hora: chat, llamada o te llamamos.' },
  }],
];

/** Longest matching prefix wins, so /settings/accessibility beats /settings. */
export function guideFor(path: string): PageGuide | null {
  const match = GUIDES.filter(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? null;
}
