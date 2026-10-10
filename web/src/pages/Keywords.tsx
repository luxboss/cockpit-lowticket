import React, { useState, useEffect, useCallback } from 'react';
import type { Keyword, SystemStatus } from '../api/types';
import {
  getKeywords,
  addKeyword,
  updateKeyword,
  deleteKeyword,
  getSystemStatus,
} from '../api/client';
import { KeywordsOverview } from '../components/KeywordsOverview';
import { AddKeywordModal, DeleteKeywordModal } from '../components/KeywordModals';
import { IconChart, IconPin, IconPause, IconPlay, IconTrash } from '../components/Icons';
import { getCountryName } from '../utils/formatters';
import './Keywords.css';

export const Keywords: React.FC = () => {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal de Adicionar
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [termInput, setTermInput] = useState('');
  const [countryInput, setCountryInput] = useState('BR');
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Modal de Excluir
  const [deletingKw, setDeletingKw] = useState<Keyword | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [kws, st] = await Promise.all([getKeywords(), getSystemStatus()]);
      setKeywords(kws);
      setStatus(st);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados do monitoramento.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleActive = async (kw: Keyword) => {
    try {
      const updated = await updateKeyword(kw.id, !kw.active);
      setKeywords((prev) => prev.map((k) => (k.id === kw.id ? updated : k)));
    } catch (err: any) {
      alert('Erro ao alterar status da palavra: ' + err.message);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTerm = termInput.trim();
    if (cleanTerm.length < 2 || cleanTerm.length > 80) {
      setAddError('O termo deve conter entre 2 e 80 caracteres.');
      return;
    }
    setIsAdding(true);
    setAddError(null);
    try {
      await addKeyword(cleanTerm, countryInput);
      setIsAddOpen(false);
      setTermInput('');
      setCountryInput('BR');
      loadData();
    } catch (err: any) {
      if (err.status === 409 || err.code === 'keyword_exists') {
        setAddError('Esta palavra já está monitorada para este país.');
      } else if (err.status === 400 && err.code === 'keyword_limit') {
        setAddError('Limite máximo de 50 palavras atingido.');
      } else {
        setAddError(err.message || 'Erro ao adicionar palavra.');
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingKw) return;
    setIsDeleting(true);
    try {
      await deleteKeyword(deletingKw.id);
      setKeywords((prev) => prev.filter((k) => k.id !== deletingKw.id));
      setDeletingKw(null);
    } catch (err: any) {
      alert('Erro ao excluir palavra: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'Nunca';
    try {
      return new Date(isoString).toLocaleString('pt-BR');
    } catch {
      return isoString;
    }
  };

  return (
    <div className="keywords-page-container" id="keywords-page">
      {/* Topo da Página com respiro */}
      <div className="keywords-top-header">
        <div className="keywords-title-wrap">
          <h2 className="page-title">
            <IconChart size={22} className="title-icon" /> Palavras Monitoradas & Status
          </h2>
          <p className="page-subtitle">Acompanhe a coleta contínua da Biblioteca da Meta e consumo de cotas</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setIsAddOpen(true);
            setAddError(null);
          }}
          id="btn-open-add-keyword"
        >
          + Nova Palavra
        </button>
      </div>

      {/* Cartões de Status do Apify & Worker */}
      {status && <KeywordsOverview status={status} />}

      {error && (
        <div className="keywords-error-box">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>
            Recarregar
          </button>
        </div>
      )}

      {/* Tabela de Palavras Monitoradas (Desktop) e Cartões Empilhados (Mobile) */}
      <section className="keywords-table-section">
        {isLoading ? (
          <div className="keywords-loading">
            <div className="spinner" />
            <p>Carregando palavras monitoradas...</p>
          </div>
        ) : keywords.length === 0 ? (
          <div className="keywords-empty">
            <IconPin size={32} className="empty-icon-svg" />
            <h3>Nenhuma palavra monitorada ainda</h3>
            <p>Adicione sua primeira palavra-chave para iniciar a coleta automática diária na Meta.</p>
          </div>
        ) : (
          <>
            {/* Visão Desktop: Tabela completa */}
            <div className="table-responsive-wrapper desktop-table-wrap">
              <table className="keywords-table" id="keywords-table">
                <thead>
                  <tr>
                    <th>Palavra-chave</th>
                    <th>País</th>
                    <th>Status</th>
                    <th>Última Coleta</th>
                    <th>Anúncios</th>
                    <th>Novos (24h)</th>
                    <th className="th-actions">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((kw) => (
                    <tr key={kw.id} id={`keyword-row-${kw.id}`} className="kw-table-row">
                      <td className="td-term">
                        <strong>{kw.term}</strong>
                      </td>
                      <td>
                        <span className="badge badge-country" title={getCountryName(kw.country)}>{kw.country}</span>
                      </td>
                      <td>
                        <span className={`badge ${kw.active ? 'badge-active' : 'badge-paused'}`}>
                          {kw.active ? 'Ativa' : 'Pausada'}
                        </span>
                      </td>
                      <td className="td-date">{formatDate(kw.lastRunAt)}</td>
                      <td className="td-num">{kw.adsTotal}</td>
                      <td className="td-num">
                        {kw.new24h > 0 ? (
                          <span className="badge badge-active">+{kw.new24h}</span>
                        ) : (
                          <span style={{ color: 'var(--text-2)' }}>0</span>
                        )}
                      </td>
                      <td className="td-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm btn-toggle-active"
                          onClick={() => handleToggleActive(kw)}
                          title={kw.active ? 'Pausar monitoramento desta palavra' : 'Retomar monitoramento desta palavra'}
                        >
                          {kw.active ? (
                            <>
                              <IconPause size={14} /> Pausar
                            </>
                          ) : (
                            <>
                              <IconPlay size={14} /> Retomar
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeletingKw(kw)}
                          title="Excluir palavra monitorada"
                          id={`btn-delete-kw-${kw.id}`}
                        >
                          <IconTrash size={14} /> Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Visão Mobile (< 768px): Cartões Empilhados */}
            <div className="mobile-cards-wrap" id="keywords-mobile-cards">
              {keywords.map((kw) => (
                <div className="keyword-mobile-card kw-card-item" key={kw.id} id={`keyword-card-${kw.id}`}>
                  <div className="km-header">
                    <span className="km-term">{kw.term}</span>
                    <span className="badge badge-country" title={getCountryName(kw.country)}>{kw.country}</span>
                  </div>
                  <div className="km-metrics">
                    <div className="km-metric">
                      <small>Status</small>
                      <span className={`badge ${kw.active ? 'badge-active' : 'badge-paused'}`}>
                        {kw.active ? 'Ativa' : 'Pausada'}
                      </span>
                    </div>
                    <div className="km-metric">
                      <small>Anúncios</small>
                      <strong>{kw.adsTotal}</strong>
                    </div>
                    <div className="km-metric">
                      <small>Novos (24h)</small>
                      {kw.new24h > 0 ? (
                        <span className="km-badge-green">+{kw.new24h}</span>
                      ) : (
                        <span style={{ color: 'var(--text-2)' }}>0</span>
                      )}
                    </div>
                  </div>
                  <div className="km-date">
                    <small>Última coleta: {formatDate(kw.lastRunAt)}</small>
                  </div>
                  <div className="km-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm btn-toggle-active"
                      onClick={() => handleToggleActive(kw)}
                    >
                      {kw.active ? (
                        <>
                          <IconPause size={14} /> Pausar
                        </>
                      ) : (
                        <>
                          <IconPlay size={14} /> Retomar
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setDeletingKw(kw)}
                    >
                      <IconTrash size={14} /> Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Modais de Ação */}
      <AddKeywordModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSubmit={handleAddSubmit}
        termInput={termInput}
        setTermInput={setTermInput}
        countryInput={countryInput}
        setCountryInput={setCountryInput}
        addError={addError}
        isAdding={isAdding}
      />

      <DeleteKeywordModal
        keyword={deletingKw}
        onClose={() => setDeletingKw(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
};
