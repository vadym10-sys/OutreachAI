import type { LocalizationResource } from "@clerk/shared/types";
import type { Locale } from "@/lib/i18n/translations";

const en: LocalizationResource = {
  locale: "en",
  socialButtonsBlockButton: "Continue with {{provider|titleize}}",
  socialButtonsBlockButtonManyInView: "{{provider|titleize}}",
  dividerText: "or",
  formFieldLabel__emailAddress: "Email address",
  formFieldLabel__password: "Password",
  formFieldLabel__newPassword: "New password",
  formFieldLabel__confirmPassword: "Confirm password",
  formFieldInputPlaceholder__emailAddress: "Enter your email address",
  formFieldInputPlaceholder__password: "Enter your password",
  formFieldInputPlaceholder__signUpPassword: "Create a password",
  formButtonPrimary: "Continue",
  formButtonPrimary__verify: "Verify",
  formFieldAction__forgotPassword: "Forgot password?",
  backButton: "Back",
  signIn: {
    start: {
      title: "Welcome back",
      subtitle: "Continue to OutreachAI",
      actionText: "Do not have an account?",
      actionLink: "Sign up"
    },
    password: {
      title: "Enter your password",
      subtitle: "Use your OutreachAI password.",
      actionLink: "Use another method"
    },
    forgotPassword: {
      title: "Reset your password",
      subtitle: "Enter your email and we will send reset instructions.",
      formTitle: "Reset password",
      resendButton: "Send again"
    },
    resetPassword: {
      title: "Create a new password",
      formButtonPrimary: "Update password",
      successMessage: "Password updated. You can sign in now."
    }
  },
  signUp: {
    start: {
      title: "Create your account",
      subtitle: "Start with Google, Apple, or your work email.",
      actionText: "Already have an account?",
      actionLink: "Sign in"
    },
    continue: {
      title: "Finish your account",
      subtitle: "Complete the missing details to continue.",
      actionText: "Already have an account?",
      actionLink: "Sign in"
    }
  }
};

const resources: Record<Locale, LocalizationResource> = {
  en,
  "en-US": { ...en, locale: "en-US" },
  ru: {
    locale: "ru",
    socialButtonsBlockButton: "Продолжить с {{provider|titleize}}",
    socialButtonsBlockButtonManyInView: "{{provider|titleize}}",
    dividerText: "или",
    formFieldLabel__emailAddress: "Email",
    formFieldLabel__password: "Пароль",
    formFieldLabel__newPassword: "Новый пароль",
    formFieldLabel__confirmPassword: "Подтвердите пароль",
    formFieldInputPlaceholder__emailAddress: "Введите email",
    formFieldInputPlaceholder__password: "Введите пароль",
    formFieldInputPlaceholder__signUpPassword: "Создайте пароль",
    formButtonPrimary: "Продолжить",
    formButtonPrimary__verify: "Подтвердить",
    formFieldAction__forgotPassword: "Забыли пароль?",
    backButton: "Назад",
    signIn: {
      start: {
        title: "С возвращением",
        subtitle: "Продолжите работу в OutreachAI",
        actionText: "Нет аккаунта?",
        actionLink: "Зарегистрироваться"
      },
      password: {
        title: "Введите пароль",
        subtitle: "Используйте пароль OutreachAI.",
        actionLink: "Другой способ входа"
      },
      forgotPassword: {
        title: "Сброс пароля",
        subtitle: "Введите email, и мы отправим инструкции.",
        formTitle: "Сброс пароля",
        resendButton: "Отправить снова"
      },
      resetPassword: {
        title: "Создайте новый пароль",
        formButtonPrimary: "Обновить пароль",
        successMessage: "Пароль обновлён. Теперь можно войти."
      }
    },
    signUp: {
      start: {
        title: "Создайте аккаунт",
        subtitle: "Начните с Google, Apple или рабочего email.",
        actionText: "Уже есть аккаунт?",
        actionLink: "Войти"
      },
      continue: {
        title: "Завершите регистрацию",
        subtitle: "Заполните недостающие данные, чтобы продолжить.",
        actionText: "Уже есть аккаунт?",
        actionLink: "Войти"
      }
    }
  },
  es: {
    locale: "es",
    socialButtonsBlockButton: "Continuar con {{provider|titleize}}",
    socialButtonsBlockButtonManyInView: "{{provider|titleize}}",
    dividerText: "o",
    formFieldLabel__emailAddress: "Email",
    formFieldLabel__password: "Contraseña",
    formFieldLabel__newPassword: "Nueva contraseña",
    formFieldLabel__confirmPassword: "Confirmar contraseña",
    formFieldInputPlaceholder__emailAddress: "Introduce tu email",
    formFieldInputPlaceholder__password: "Introduce tu contraseña",
    formFieldInputPlaceholder__signUpPassword: "Crea una contraseña",
    formButtonPrimary: "Continuar",
    formButtonPrimary__verify: "Verificar",
    formFieldAction__forgotPassword: "¿Olvidaste tu contraseña?",
    backButton: "Atrás",
    signIn: { start: { title: "Bienvenido de nuevo", subtitle: "Continúa en OutreachAI", actionText: "¿No tienes cuenta?", actionLink: "Regístrate" } },
    signUp: { start: { title: "Crea tu cuenta", subtitle: "Empieza con Google, Apple o tu email de trabajo.", actionText: "¿Ya tienes cuenta?", actionLink: "Inicia sesión" } }
  },
  fr: {
    locale: "fr",
    socialButtonsBlockButton: "Continuer avec {{provider|titleize}}",
    socialButtonsBlockButtonManyInView: "{{provider|titleize}}",
    dividerText: "ou",
    formFieldLabel__emailAddress: "Email",
    formFieldLabel__password: "Mot de passe",
    formFieldLabel__newPassword: "Nouveau mot de passe",
    formFieldLabel__confirmPassword: "Confirmer le mot de passe",
    formFieldInputPlaceholder__emailAddress: "Saisissez votre email",
    formFieldInputPlaceholder__password: "Saisissez votre mot de passe",
    formFieldInputPlaceholder__signUpPassword: "Créez un mot de passe",
    formButtonPrimary: "Continuer",
    formButtonPrimary__verify: "Vérifier",
    formFieldAction__forgotPassword: "Mot de passe oublié ?",
    backButton: "Retour",
    signIn: { start: { title: "Bon retour", subtitle: "Continuez vers OutreachAI", actionText: "Pas encore de compte ?", actionLink: "Créer un compte" } },
    signUp: { start: { title: "Créez votre compte", subtitle: "Commencez avec Google, Apple ou votre email professionnel.", actionText: "Déjà un compte ?", actionLink: "Se connecter" } }
  },
  it: {
    locale: "it",
    socialButtonsBlockButton: "Continua con {{provider|titleize}}",
    socialButtonsBlockButtonManyInView: "{{provider|titleize}}",
    dividerText: "o",
    formFieldLabel__emailAddress: "Email",
    formFieldLabel__password: "Password",
    formFieldLabel__newPassword: "Nuova password",
    formFieldLabel__confirmPassword: "Conferma password",
    formFieldInputPlaceholder__emailAddress: "Inserisci la tua email",
    formFieldInputPlaceholder__password: "Inserisci la password",
    formFieldInputPlaceholder__signUpPassword: "Crea una password",
    formButtonPrimary: "Continua",
    formButtonPrimary__verify: "Verifica",
    formFieldAction__forgotPassword: "Password dimenticata?",
    backButton: "Indietro",
    signIn: { start: { title: "Bentornato", subtitle: "Continua in OutreachAI", actionText: "Non hai un account?", actionLink: "Registrati" } },
    signUp: { start: { title: "Crea il tuo account", subtitle: "Inizia con Google, Apple o la tua email aziendale.", actionText: "Hai già un account?", actionLink: "Accedi" } }
  },
  pl: {
    locale: "pl",
    socialButtonsBlockButton: "Kontynuuj z {{provider|titleize}}",
    socialButtonsBlockButtonManyInView: "{{provider|titleize}}",
    dividerText: "lub",
    formFieldLabel__emailAddress: "Email",
    formFieldLabel__password: "Hasło",
    formFieldLabel__newPassword: "Nowe hasło",
    formFieldLabel__confirmPassword: "Potwierdź hasło",
    formFieldInputPlaceholder__emailAddress: "Wpisz email",
    formFieldInputPlaceholder__password: "Wpisz hasło",
    formFieldInputPlaceholder__signUpPassword: "Utwórz hasło",
    formButtonPrimary: "Kontynuuj",
    formButtonPrimary__verify: "Zweryfikuj",
    formFieldAction__forgotPassword: "Nie pamiętasz hasła?",
    backButton: "Wstecz",
    signIn: { start: { title: "Witaj ponownie", subtitle: "Kontynuuj w OutreachAI", actionText: "Nie masz konta?", actionLink: "Zarejestruj się" } },
    signUp: { start: { title: "Utwórz konto", subtitle: "Zacznij przez Google, Apple albo firmowy email.", actionText: "Masz już konto?", actionLink: "Zaloguj się" } }
  }
};

export function getClerkLocalization(locale: Locale): LocalizationResource {
  return resources[locale] || en;
}
