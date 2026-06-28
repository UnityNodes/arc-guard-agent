export type Locale = 'en' | 'ua';

const translations = {
  // ── Navigation & Tabs ──
  'nav.rules': { en: 'Rules', ua: 'Правила' },
  'nav.alerts': { en: 'Alerts', ua: 'Сповіщення' },
  'nav.chat': { en: 'Chat', ua: 'Чат' },
  'nav.settings': { en: 'Settings', ua: 'Налаштування' },
  'nav.main': { en: 'Main', ua: 'Головна' },

  // ── Wallet ──
  'wallet.connect': { en: 'Connect Wallet', ua: 'Підключити гаманець' },
  'wallet.disconnect': { en: 'Disconnect', ua: 'Відключити' },
  'wallet.verify': { en: 'Verify Your Wallet', ua: 'Підтвердьте гаманець' },
  'wallet.signFree': { en: 'Sign a free message to authenticate', ua: 'Підпишіть безкоштовне повідомлення для авторизації' },
  'wallet.signIn': { en: 'Sign In with Wallet', ua: 'Увійти з гаманцем' },
  'wallet.signing': { en: 'Signing...', ua: 'Підписання...' },
  'wallet.noGas': { en: 'No gas', ua: 'Без газу' },
  'wallet.noTx': { en: 'No transaction', ua: 'Без транзакції' },
  'wallet.noEmail': { en: 'No email', ua: 'Без email' },
  'wallet.connected': { en: 'Connected', ua: 'Підключено' },
  'wallet.changed': { en: 'Wallet Changed', ua: 'Гаманець змінено' },
  'wallet.switchedMsg': { en: 'Each wallet has its own AI Agent and settings.', ua: 'Кожен гаманець має свого AI Агента та налаштування.' },
  'wallet.switchedFrom': { en: 'You switched from', ua: 'Ви переключились з' },
  'wallet.switchedTo': { en: 'to', ua: 'на' },
  'wallet.copyAddress': { en: 'Copy Address', ua: 'Копіювати адресу' },
  'wallet.copied': { en: 'Copied!', ua: 'Скопійовано!' },
  'wallet.viewExplorer': { en: 'View on Explorer', ua: 'Переглянути в Explorer' },
  'wallet.myTokens': { en: 'My Tokens', ua: 'Мої токени' },
  'wallet.noTokens': { en: 'No tokens found on Arc', ua: 'Токени на Arc не знайдено' },

  // ── Agent Wallet ──
  'agent.title': { en: 'AI Agent Wallet', ua: 'Гаманець AI Агента' },
  'agent.subtitle': { en: 'Autonomous protection on Arc', ua: 'Автономний захист на Arc' },
  'agent.create': { en: 'Create AI Agent', ua: 'Створити AI Агента' },
  'agent.creating': { en: 'Creating...', ua: 'Створення...' },
  'agent.description': { en: 'Non-custodial agent wallet on Arc. Executes protective swaps automatically when you don\'t respond to alerts.', ua: 'Некастодіальний гаманець агента на Arc. Автоматично виконує захисні свапи, коли ви не відповідаєте на сповіщення.' },
  'agent.totalPortfolio': { en: 'TOTAL PORTFOLIO', ua: 'ЗАГАЛЬНЕ ПОРТФОЛІО' },
  'agent.agentWallet': { en: 'Agent Wallet', ua: 'Гаманець Агента' },
  'agent.assets': { en: 'ASSETS', ua: 'АКТИВИ' },
  'agent.withdraw': { en: 'Withdraw', ua: 'Вивести' },
  'agent.history': { en: 'History', ua: 'Історія' },
  'agent.sell': { en: 'Sell', ua: 'Продати' },
  'agent.buy': { en: 'Buy', ua: 'Купити' },
  'agent.showMore': { en: 'Show {count} more', ua: 'Показати ще {count}' },
  'agent.fundAddress': { en: 'Send USDC to this address to fund the agent.', ua: 'Надішліть USDC на цю адресу для поповнення агента.' },

  // ── Rules ──
  'rules.title': { en: 'Rules', ua: 'Правила' },
  'rules.newRule': { en: 'New Rule', ua: 'Нове правило' },
  'rules.noRules': { en: 'No rules yet', ua: 'Правил поки немає' },
  'rules.createFirst': { en: 'Create your first price alert above', ua: 'Створіть перше цінове сповіщення вище' },
  'rules.above': { en: 'above', ua: 'вище' },
  'rules.below': { en: 'below', ua: 'нижче' },
  'rules.cooldown': { en: 'Cooldown', ua: 'Перезарядка' },
  'rules.delete': { en: 'Delete', ua: 'Видалити' },
  'rules.edit': { en: 'Edit', ua: 'Редагувати' },

  // ── Alerts ──
  'alerts.title': { en: 'Alerts', ua: 'Сповіщення' },
  'alerts.noAlerts': { en: 'No alerts yet', ua: 'Сповіщень поки немає' },
  'alerts.acknowledge': { en: 'Acknowledge', ua: 'Підтвердити' },
  'alerts.execute': { en: 'Execute', ua: 'Виконати' },

  // ── Chat ──
  'chat.placeholder': { en: 'Message...', ua: 'Повідомлення...' },
  'chat.aegisOnline': { en: 'Online', ua: 'Онлайн' },
  'chat.aegisAgent': { en: 'Aegis Agent', ua: 'Агент Aegis' },

  // ── Settings ──
  'settings.title': { en: 'Settings', ua: 'Налаштування' },
  'settings.maxTx': { en: 'Max Transaction Size', ua: 'Макс. розмір транзакції' },
  'settings.dailyLimit': { en: 'Daily Limit', ua: 'Денний ліміт' },
  'settings.slippage': { en: 'Slippage Tolerance', ua: 'Допуск прослизання' },
  'settings.autoMode': { en: 'Auto Mode', ua: 'Автоматичний режим' },
  'settings.autoModeDesc': { en: 'Automatically execute protective swaps when alerts escalate', ua: 'Автоматично виконувати захисні свапи при ескалації сповіщень' },
  'settings.network': { en: 'Network', ua: 'Мережа' },
  'settings.telegram': { en: 'Telegram', ua: 'Telegram' },
  'settings.phone': { en: 'Phone Number', ua: 'Номер телефону' },
  'settings.save': { en: 'Save', ua: 'Зберегти' },
  'settings.saved': { en: 'Saved!', ua: 'Збережено!' },

  // ── Swap Card ──
  'swap.title': { en: 'Swap', ua: 'Обмін' },
  'swap.amount': { en: 'Amount', ua: 'Сума' },
  'swap.rate': { en: 'Rate', ua: 'Курс' },
  'swap.minOutput': { en: 'Min output', ua: 'Мін. вихід' },
  'swap.fee': { en: 'Fee (DEX)', ua: 'Комісія (DEX)' },
  'swap.priceImpact': { en: 'Price impact', ua: 'Вплив на ціну' },
  'swap.slippage': { en: 'Slippage', ua: 'Прослизання' },
  'swap.confirm': { en: 'Swap', ua: 'Обміняти' },
  'swap.cancel': { en: 'Cancel', ua: 'Скасувати' },
  'swap.executed': { en: 'Swap executed!', ua: 'Обмін виконано!' },
  'swap.yesExecute': { en: 'Yes, execute the swap', ua: 'Так, виконати обмін' },

  // ── Onboarding ──
  'onboarding.welcome': { en: 'Welcome to GuardAgent', ua: 'Ласкаво просимо до GuardAgent' },
  'onboarding.step1Title': { en: 'Create Your AI Agent', ua: 'Створіть AI Агента' },
  'onboarding.step1Desc': { en: 'Your agent gets its own wallet on Arc to execute protective swaps automatically.', ua: 'Ваш агент отримає власний гаманець на Arc для автоматичних захисних свапів.' },
  'onboarding.step2Title': { en: 'Set Up Price Rules', ua: 'Налаштуйте цінові правила' },
  'onboarding.step2Desc': { en: 'Create alerts for when tokens go above or below your target prices.', ua: 'Створіть сповіщення коли токени перевищують або падають нижче ваших цільових цін.' },
  'onboarding.step3Title': { en: 'Fund & Relax', ua: 'Поповніть та відпочивайте' },
  'onboarding.step3Desc': { en: 'Send ETH to your agent wallet. It will protect your positions 24/7.', ua: 'Надішліть ETH на гаманець агента. Він захищатиме ваші позиції 24/7.' },
  'onboarding.getStarted': { en: 'Get Started', ua: 'Почати' },
  'onboarding.next': { en: 'Next', ua: 'Далі' },
  'onboarding.skip': { en: 'Skip', ua: 'Пропустити' },

  // ── Landing ──
  'landing.hero': { en: 'AI-Powered Crypto Protection', ua: 'Захист криптоактивів з AI' },
  'landing.heroSub': { en: 'Autonomous agent that monitors prices and executes protective swaps when you can\'t.', ua: 'Автономний агент що моніторить ціни та виконує захисні свапи коли ви не можете.' },

  // ── Common ──
  'common.loading': { en: 'Loading...', ua: 'Завантаження...' },
  'common.error': { en: 'Error', ua: 'Помилка' },
  'common.close': { en: 'Close', ua: 'Закрити' },
  'common.confirm': { en: 'Confirm', ua: 'Підтвердити' },
  'common.back': { en: 'Back', ua: 'Назад' },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = translations[key];
  let text: string = entry?.[locale] ?? entry?.en ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

export default translations;
