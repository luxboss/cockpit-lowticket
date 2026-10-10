import React from 'react';
import type { Keyword } from '../api/types';
import { IconClose } from './Icons';

interface AddKeywordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  termInput: string;
  setTermInput: (v: string) => void;
  countryInput: string;
  setCountryInput: (v: string) => void;
  addError: string | null;
  isAdding: boolean;
}

export const AddKeywordModal: React.FC<AddKeywordModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  termInput,
  setTermInput,
  countryInput,
  setCountryInput,
  addError,
  isAdding,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} id="modal-add-keyword">
        <div className="modal-header">
          <h3 className="modal-title">Nova Palavra Monitorada</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="add-keyword-form">
          {addError && (
            <div className="form-error-alert" id="add-keyword-error">
              {addError}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="input-new-term" className="form-label">
              Termo para Coleta (2 a 80 caracteres)
            </label>
            <input
              type="text"
              id="input-new-term"
              className="form-input"
              value={termInput}
              onChange={(e) => setTermInput(e.target.value)}
              placeholder="Ex: low ticket, emagrecimento, curso..."
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="select-new-country" className="form-label">
              País da Biblioteca da Meta
            </label>
            <select
              id="select-new-country"
              className="form-input"
              value={countryInput}
              onChange={(e) => setCountryInput(e.target.value)}
            >
              <option value="BR">Brasil (BR)</option>
              <option value="PT">Portugal (PT)</option>
              <option value="US">Estados Unidos (US)</option>
              <option value="ES">Espanha (ES)</option>
            </select>
          </div>

          <div className="modal-actions-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isAdding}
              id="btn-confirm-add-keyword"
            >
              {isAdding ? 'Salvando...' : 'Adicionar Palavra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DeleteKeywordModalProps {
  keyword: Keyword | null;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export const DeleteKeywordModal: React.FC<DeleteKeywordModalProps> = ({
  keyword,
  onClose,
  onConfirm,
  isDeleting,
}) => {
  if (!keyword) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} id="modal-delete-keyword">
        <div className="modal-header">
          <h3 className="modal-title">Confirmar Exclusão</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </div>

        <div className="delete-modal-body">
          <p>
            Tem certeza de que deseja parar de monitorar e excluir a palavra{' '}
            <strong>"{keyword.term}"</strong> ({keyword.country})?
          </p>
          <small className="delete-warning">
            Os anúncios já coletados permanecem na base de busca.
          </small>
        </div>

        <div className="modal-actions-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={isDeleting}
            id="btn-confirm-delete-keyword"
          >
            {isDeleting ? 'Excluindo...' : 'Sim, Excluir Palavra'}
          </button>
        </div>
      </div>
    </div>
  );
};
