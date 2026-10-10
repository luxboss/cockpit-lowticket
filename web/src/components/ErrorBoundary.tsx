import { Component, ErrorInfo, ReactNode } from 'react';
import { IconAlertTriangle, IconRefresh } from './Icons';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou erro não tratado:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container" id="error-boundary-view">
          <div className="error-boundary-card">
            <div className="error-boundary-icon-box">
              <IconAlertTriangle size={36} className="error-boundary-icon" />
            </div>
            <h2 className="error-boundary-title">
              {this.props.fallbackTitle || 'Ocorreu um erro ao carregar esta tela'}
            </h2>
            <p className="error-boundary-desc">
              Não se preocupe, seus dados estão seguros. Você pode recarregar a página para continuar navegando normalmente.
            </p>
            {this.state.error?.message && (
              <div className="error-boundary-details" title="Detalhes do erro">
                <code>{this.state.error.message}</code>
              </div>
            )}
            <div className="error-boundary-actions">
              <button
                type="button"
                className="btn btn-primary btn-error-reload"
                id="btn-error-reload"
                onClick={this.handleReload}
              >
                <IconRefresh size={16} /> Recarregar página
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-error-reset"
                id="btn-error-reset"
                onClick={this.handleReset}
              >
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
