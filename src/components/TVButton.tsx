import type { ButtonHTMLAttributes, ReactNode } from 'react';
export function TVButton({id,children,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{id:string;children:ReactNode}) {
  return <button {...props} data-focus-id={id} className={`tv-button ${className}`}>{children}</button>;
}
