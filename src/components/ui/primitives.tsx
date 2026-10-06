"use client";
import * as D from "@radix-ui/react-dialog";
import { LoaderCircle, X } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: boolean; small?: boolean; loading?: boolean };
export function Button({ children, className, variant = "primary", icon, small, loading, disabled, type = "button", ...props }: ButtonProps) { return <button type={type} className={cn("button", `button-${variant}`, icon && "button-icon", small && "button-small", className)} disabled={disabled || loading} {...props}>{loading && <LoaderCircle size={17} className="spinner" aria-hidden="true" />}{children}</button>; }
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cn("field", className)} {...props} />; }
export function Badge({ children, muted = false }: { children: ReactNode; muted?: boolean }) { return <span className={cn("badge", muted && "badge-muted")}>{children}</span>; }
export function Dialog({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; footer?: ReactNode }) { return <D.Root open={open} onOpenChange={onOpenChange}><D.Portal><D.Overlay className="dialog-overlay" /><D.Content className="dialog-content"><D.Title className="dialog-title">{title}</D.Title><D.Description className="dialog-description">{description}</D.Description><D.Close className="dialog-close" aria-label="Close dialog"><X size={20} aria-hidden="true" /></D.Close>{children}{footer && <div className="dialog-footer">{footer}</div>}</D.Content></D.Portal></D.Root>; }
