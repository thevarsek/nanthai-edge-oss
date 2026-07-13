import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import "./PublicConsentManager.css";
import {
  CONSENT_REVISION,
  CONSENT_STORAGE_KEY,
  setAnalyticsConsent,
} from "@/lib/analyticsConsent";
import { applyAnalyticsConsent } from "@/lib/analytics";
import {
  consumeConsentPreferencesRequest,
  SHOW_CONSENT_PREFERENCES_EVENT,
} from "@/lib/consentEvents";

type ConsentCopy = {
  acceptAll: string;
  analyticsDescription: string;
  analyticsTitle: string;
  description: string;
  manage: string;
  necessaryDescription: string;
  necessaryTitle: string;
  preferencesDescription: string;
  preferencesTitle: string;
  reject: string;
  replayDescription: string;
  replayTitle: string;
  save: string;
  title: string;
};

const ENGLISH_COPY: ConsentCopy = {
  acceptAll: "Accept all",
  analyticsDescription: "Anonymous page and product events that help us understand acquisition and improve Edge.",
  analyticsTitle: "Product analytics",
  description: "Choose whether NanthAI may use optional analytics and privacy-masked session replay. The app works without either.",
  manage: "Manage preferences",
  necessaryDescription: "Required to remember this choice and provide requested site and account functionality.",
  necessaryTitle: "Necessary",
  preferencesDescription: "Optional tracking is disabled until you choose it. You can change this choice from the public-site footer.",
  preferencesTitle: "Privacy preferences",
  reject: "Reject non-essential",
  replayDescription: "A separately optional, masked recording of interface interactions used to diagnose usability problems. Chat text and inputs remain masked.",
  replayTitle: "Session replay",
  save: "Save preferences",
  title: "Your privacy choices",
};

const CONSENT_COPY: Record<string, ConsentCopy> = {
  en: ENGLISH_COPY,
  de: {
    ...ENGLISH_COPY,
    acceptAll: "Alle akzeptieren",
    description: "Wähle, ob NanthAI optionale Analysen und datenschutzmaskierte Sitzungswiedergaben verwenden darf. Die App funktioniert ohne beides.",
    manage: "Einstellungen verwalten",
    preferencesTitle: "Datenschutzeinstellungen",
    reject: "Nicht notwendige ablehnen",
    save: "Einstellungen speichern",
    title: "Deine Datenschutzauswahl",
  },
  es: {
    ...ENGLISH_COPY,
    acceptAll: "Aceptar todo",
    description: "Elige si NanthAI puede usar analíticas opcionales y repeticiones de sesión enmascaradas. La aplicación funciona sin ambas.",
    manage: "Gestionar preferencias",
    preferencesTitle: "Preferencias de privacidad",
    reject: "Rechazar lo no esencial",
    save: "Guardar preferencias",
    title: "Tus opciones de privacidad",
  },
  fr: {
    ...ENGLISH_COPY,
    acceptAll: "Tout accepter",
    description: "Choisissez si NanthAI peut utiliser des analyses facultatives et des relectures de session masquées. L’application fonctionne sans les deux.",
    manage: "Gérer les préférences",
    preferencesTitle: "Préférences de confidentialité",
    reject: "Refuser le non essentiel",
    save: "Enregistrer les préférences",
    title: "Vos choix de confidentialité",
  },
  it: {
    ...ENGLISH_COPY,
    acceptAll: "Accetta tutto",
    description: "Scegli se NanthAI può usare analisi facoltative e replay di sessione mascherati. L’app funziona senza entrambi.",
    manage: "Gestisci preferenze",
    preferencesTitle: "Preferenze sulla privacy",
    reject: "Rifiuta non essenziali",
    save: "Salva preferenze",
    title: "Le tue scelte sulla privacy",
  },
  ja: {
    ...ENGLISH_COPY,
    acceptAll: "すべて許可",
    description: "任意の分析とプライバシー保護されたセッションリプレイの使用を選択できます。どちらを拒否してもアプリは利用できます。",
    manage: "設定を管理",
    preferencesTitle: "プライバシー設定",
    reject: "必須以外を拒否",
    save: "設定を保存",
    title: "プライバシーの選択",
  },
  zh: {
    ...ENGLISH_COPY,
    acceptAll: "全部接受",
    description: "选择是否允许 NanthAI 使用可选分析和隐私遮蔽的会话回放。拒绝两者也不影响应用使用。",
    manage: "管理偏好",
    preferencesTitle: "隐私偏好",
    reject: "拒绝非必要项",
    save: "保存偏好",
    title: "你的隐私选择",
  },
};

function translation(copy: ConsentCopy): CookieConsent.Translation {
  return {
    consentModal: {
      title: copy.title,
      description: `${copy.description} <a href="/privacy">Privacy policy</a>`,
      acceptAllBtn: copy.acceptAll,
      acceptNecessaryBtn: copy.reject,
      showPreferencesBtn: copy.manage,
    },
    preferencesModal: {
      title: copy.preferencesTitle,
      acceptAllBtn: copy.acceptAll,
      acceptNecessaryBtn: copy.reject,
      savePreferencesBtn: copy.save,
      closeIconLabel: "Close",
      sections: [
        { description: copy.preferencesDescription },
        {
          title: copy.necessaryTitle,
          description: copy.necessaryDescription,
          linkedCategory: "necessary",
        },
        {
          title: copy.analyticsTitle,
          description: copy.analyticsDescription,
          linkedCategory: "analytics",
        },
        {
          title: copy.replayTitle,
          description: copy.replayDescription,
          linkedCategory: "session_replay",
        },
      ],
    },
  };
}

function syncConsent() {
  const analytics = CookieConsent.acceptedCategory("analytics");
  const sessionReplay = analytics && CookieConsent.acceptedCategory("session_replay");
  const consent = { analytics, decided: true, sessionReplay };
  setAnalyticsConsent(consent);
  void applyAnalyticsConsent(consent);
}

export default function PublicConsentManager() {
  useEffect(() => {
    const showPreferences = () => {
      consumeConsentPreferencesRequest();
      CookieConsent.showPreferences();
    };
    window.addEventListener(SHOW_CONSENT_PREFERENCES_EVENT, showPreferences);

    void CookieConsent.run({
      mode: "opt-in",
      revision: CONSENT_REVISION,
      autoClearCookies: true,
      disablePageInteraction: false,
      hideFromBots: true,
      cookie: {
        name: CONSENT_STORAGE_KEY,
        expiresAfterDays: 182,
        useLocalStorage: true,
      },
      guiOptions: {
        consentModal: {
          layout: "box wide",
          position: "bottom center",
          equalWeightButtons: true,
        },
        preferencesModal: {
          layout: "box",
          equalWeightButtons: true,
        },
      },
      categories: {
        necessary: { enabled: true, readOnly: true },
        analytics: { autoClear: { cookies: [{ name: /^ph_/ }] } },
        session_replay: {},
      },
      language: {
        default: "en",
        autoDetect: "document",
        translations: Object.fromEntries(
          Object.entries(CONSENT_COPY).map(([locale, copy]) => [locale, translation(copy)]),
        ),
      },
      onConsent: syncConsent,
      onChange: syncConsent,
    }).then(() => {
      // The library initializes once per document. Re-show a pending choice when
      // a visitor returns to the public site after navigating through the app.
      if (consumeConsentPreferencesRequest()) {
        CookieConsent.showPreferences();
      } else if (!CookieConsent.validConsent()) {
        CookieConsent.show(true);
      }
    });

    return () => {
      window.removeEventListener(SHOW_CONSENT_PREFERENCES_EVENT, showPreferences);
      CookieConsent.hide();
      CookieConsent.hidePreferences();
    };
  }, []);

  return null;
}
