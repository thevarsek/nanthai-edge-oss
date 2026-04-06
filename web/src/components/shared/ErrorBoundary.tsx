// components/shared/ErrorBoundary.tsx
// React class-based error boundary — catches render errors in child trees
// and shows a fallback UI instead of a blank white screen.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional label shown in the heading (e.g. "page", "app"). */
  level?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.level ? `:${this.props.level}` : ""}]`, error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-[300px] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-destructive/12 flex items-center justify-center mx-auto">
            <span className="text-destructive text-2xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h2>
          <p className="text-sm text-foreground/55">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={this.handleRetry}
              className="px-4 py-2 rounded-lg border border-border text-sm text-secondary hover:text-foreground transition-colors"
            >
              Try again
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
