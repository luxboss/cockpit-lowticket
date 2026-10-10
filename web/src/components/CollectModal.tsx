import React, { useState, useEffect, useRef } from 'react';
import { collectNow, getCollectRun } from '../api/client';
import type { CollectRun } from '../api/types';
import { IconCheck, IconClose } from './Icons';
import './CollectModal.css';

interface CollectModalProps {
  term: string;
  country?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CollectModal: React.FC<CollectModalProps> = ({
  term,
  country = 'BR',
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'idle' | 'starting' | 'polling' | 'done' | 'error'>('idle');
  const [run, setRun] = useState<CollectRun | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setStep('idle');
      setRun(null);
      setErrorMessage(null);
      return;
    }

    startCollection();

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isOpen, term]);

  const startCollection = async () => {
    setStep('starting');
    setErrorMessage(null);
    try {
      const res = await collectNow(term, country);
      setStep('polling');
      pollRun(res.runId);
    } catch (err: any) {
      setStep('error');
      if (err.status === 429 || err.code === 'daily_limit') {
        setErrorMessage('Limite diário de coletas imediatas atingido (máximo 150/dia).');
      } else if (err.status === 409 || err.code === 'run_in_progress') {
        setErrorMessage('Já existe uma coleta em andamento para esta palavra. Aguarde alguns instantes.');
      } else if (err.status === 503 || err.code === 'apify_not_configured') {
        setErrorMessage('Serviço de coleta Apify não está configurado no servidor.');
      } else {
        setErrorMessage(err.message || 'Erro ao iniciar coleta imediata.');
      }
    }
  };

  const pollRun = (runId: number) => {
    pollTimerRef.current = setInterval(async () => {
      try {
        const curRun = await getCollectRun(runId);
        setRun(curRun);
        if (curRun.status === 'succeeded') {
          clearInterval(pollTimerRef.current);
          setStep('done');
        } else if (curRun.status === 'failed') {
          clearInterval(pollTimerRef.current);
          setStep('error');
          setErrorMessage(curRun.error || 'A coleta na Meta falhou. Tente novamente mais tarde.');
        }
      } catch (e: any) {
        clearInterval(pollTimerRef.current);
        setStep('error');
        setErrorMessage('Falha ao acompanhar o progresso da coleta.');
      }
    }, 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} id="modal-collect-now">
        <div className="modal-header">
          <h3 className="modal-title">Buscar na Meta Agora</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </div>

        <div className="collect-modal-body">
          <p className="collect-term-info">
            Palavra-chave: <strong>"{term}"</strong> ({country})
          </p>

          {step === 'starting' && (
            <div className="collect-status-box loading">
              <div className="spinner" />
              <p>Iniciando coleta na Biblioteca da Meta...</p>
            </div>
          )}

          {step === 'polling' && (
            <div className="collect-status-box loading">
              <div className="spinner" />
              <p>Varrendo a Biblioteca de Anúncios em tempo real...</p>
              <small>Esta operação costuma levar cerca de 15 a 30 segundos.</small>
            </div>
          )}

          {step === 'done' && (
            <div className="collect-status-box success">
              <span className="status-icon-svg success-icon">
                <IconCheck size={28} />
              </span>
              <h4>Coleta concluída com sucesso!</h4>
              <p>
                {run?.received || 0} anúncios recebidos e {run?.inserted || 0} anúncios novos inseridos.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onSuccess();
                }}
                id="btn-collect-reload-search"
              >
                Atualizar resultados da busca
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="collect-status-box error">
              <h4>Não foi possível concluir</h4>
              <p>{errorMessage}</p>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
