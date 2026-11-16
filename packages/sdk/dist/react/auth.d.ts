/** @jsxImportSource react */
import { type ReactNode } from "react";
import { type FieldSchema } from "../headless/schema.ts";
type User = Record<string, unknown>;
export interface SignInFormProps {
    /** Where to go after signing in. Leave out to stay and use onSuccess. */
    redirectTo?: string;
    onSuccess?: (user: User) => void;
    /** The auth identity field. Default email. */
    identityField?: string;
    forgotPasswordHref?: string;
    signUpHref?: string;
    submitLabel?: string;
    className?: string;
    /** Extra content under the button. */
    children?: ReactNode;
}
export declare function SignInForm({ redirectTo, onSuccess, identityField, forgotPasswordHref, signUpHref, submitLabel, className, children, }: SignInFormProps): import("react").JSX.Element;
export interface SignUpFormProps {
    /** Fields to ask for. Default: what the auth entity in the schema lets people set, or email, password, and name. */
    fields?: readonly FieldSchema[];
    include?: readonly string[];
    signInHref?: string;
    onSuccess?: (message: string) => void;
    submitLabel?: string;
    className?: string;
}
export declare function SignUpForm({ fields, include, signInHref, onSuccess, submitLabel, className }: SignUpFormProps): import("react").JSX.Element;
export declare function ForgotPasswordForm({ className, signInHref }: {
    className?: string;
    signInHref?: string;
}): import("react").JSX.Element;
export declare function ResetPasswordForm({ token, className, signInHref }: {
    token?: string;
    className?: string;
    signInHref?: string;
}): import("react").JSX.Element;
export interface AuthButtonProps {
    signInHref?: string;
    /** Where to go after signing out. Default: reload the current page. */
    afterSignOut?: string;
    className?: string;
}
/** "Sign in" when signed out, "Sign out" when signed in. */
export declare function AuthButton({ signInHref, afterSignOut, className }: AuthButtonProps): import("react").JSX.Element;
export interface UserMenuProps extends AuthButtonProps {
    /** Links for the menu, like an account page. */
    links?: {
        href: string;
        label: string;
    }[];
}
/** The signed in user's name with a small menu: your links, then Sign out. A disclosure, so it works with any input. */
export declare function UserMenu({ links, signInHref, afterSignOut, className }: UserMenuProps): import("react").JSX.Element;
export interface GateProps {
    children?: ReactNode;
    /** Shown when signed out (or without the role). Default: nothing. */
    fallback?: ReactNode;
    /** Shown while the user loads. Default: nothing. */
    loading?: ReactNode;
    roles?: readonly string[];
    /** Send signed out people here instead of showing fallback. */
    redirectTo?: string;
}
/**
 * Shows children only to signed in users. This hides UI; it does not protect data.
 * Bakorin's policies protect data, and requireAuth or authMiddleware protect pages.
 */
export declare function Gate({ children, fallback, loading, roles, redirectTo }: GateProps): import("react").JSX.Element;
export {};
