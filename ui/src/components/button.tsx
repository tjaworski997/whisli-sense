import type { ButtonHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export function Button({ variant = "default", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "danger"
}) {
  return <button
    type={type}
    className={cn("whisli-button", variant === "ghost" && "whisli-button-ghost", variant === "danger" && "whisli-button-danger", className)}
    {...props}
  />
}
