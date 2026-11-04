import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Portal, DocumentInfo, CrawlJob } from '../types';
import { useAuth } from './AuthContext';

interface PortalContextType {
  portals: Portal[];
  selectedPortal: Portal | null;
  portalDocuments: DocumentInfo[];
  portalCrawls: CrawlJob[];
  isLoadingPortals: boolean;
  isLoadingDocuments: boolean;
  isLoadingCrawls: boolean;
  portalError: string | null;
  setSelectedPortal: (portal: Portal | null) => void;
  setPortalError: (err: string | null) => void;
  loadPortals: () => Promise<void>;
  loadPortalDocuments: (portalId: string) => Promise<void>;
  loadPortalCrawls: (portalId: string) => Promise<void>;
  createPortal: (url: string, name?: string) => Promise<Portal>;
  deletePortal: (portalId: string) => Promise<void>;
}

const PortalContext = createContext<PortalContextType | undefined>(undefined);

export const PortalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authToken, getClient } = useAuth();
  const [portals, setPortals] = useState<Portal[]>([]);
  const [selectedPortal, setSelectedPortal] = useState<Portal | null>(null);
  const [portalDocuments, setPortalDocuments] = useState<DocumentInfo[]>([]);
  const [portalCrawls, setPortalCrawls] = useState<CrawlJob[]>([]);
  const [isLoadingPortals, setIsLoadingPortals] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [isLoadingCrawls, setIsLoadingCrawls] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const loadPortals = useCallback(async () => {
    if (!authToken) return;
    setIsLoadingPortals(true);
    setPortalError(null);
    try {
      const client = getClient();
      const list = await client.listPortfolios();
      const normalizedPortals: Portal[] = list.map((p: any) => ({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        slug: p.slug,
        portalUrl: p.portalUrl || p.portfolioUrl,
        portfolioUrl: p.portfolioUrl || p.portalUrl,
        isPublic: p.isPublic ?? true,
        documentCount: p.documentCount ?? 0,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      setPortals(normalizedPortals);
      setSelectedPortal(prev => {
        if (prev) {
          const matched = normalizedPortals.find(p => p.id === prev.id);
          return matched || null;
        }
        return null;
      });
    } catch (err: any) {
      setPortalError(err.message || 'Failed to load portals.');
    } finally {
      setIsLoadingPortals(false);
    }
  }, [authToken, getClient]);

  const loadPortalCrawls = useCallback(async (portalId: string) => {
    if (!authToken || !portalId) return;
    if (portalCrawls.length === 0) {
      setIsLoadingCrawls(true);
    }
    try {
      const client = getClient();
      const crawls = await client.listPortalCrawls(portalId);
      if (Array.isArray(crawls)) {
        setPortalCrawls(crawls);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingCrawls(false);
    }
  }, [authToken, getClient, portalCrawls.length]);

  const loadPortalDocuments = useCallback(async (portalId: string) => {
    if (!authToken || !portalId) return;
    if (portalDocuments.length === 0) {
      setIsLoadingDocuments(true);
    }
    try {
      const client = getClient();
      const [docs] = await Promise.all([
        client.getPortfolioDocuments(portalId),
        loadPortalCrawls(portalId),
      ]);
      setPortalDocuments(docs);
    } catch {
      // keep existing documents if query fails
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [authToken, getClient, loadPortalCrawls, portalDocuments.length]);

  // Initial load when authToken changes
  useEffect(() => {
    if (authToken) {
      loadPortals();
    } else {
      setPortals([]);
      setSelectedPortal(null);
      setPortalDocuments([]);
      setPortalCrawls([]);
    }
  }, [authToken, loadPortals]);

  // Load documents whenever selected portal changes
  useEffect(() => {
    if (selectedPortal?.id) {
      loadPortalDocuments(selectedPortal.id);
    } else {
      setPortalDocuments([]);
      setPortalCrawls([]);
    }
  }, [selectedPortal?.id, loadPortalDocuments]);

  const createPortal = useCallback(async (url: string, name?: string) => {
    setPortalError(null);
    const client = getClient();
    const created = await client.createPortfolio(url, name);
    const newPortal: Portal = {
      id: created.id,
      tenantId: created.tenantId,
      name: created.name,
      slug: created.slug,
      portalUrl: created.portalUrl || created.portfolioUrl,
      portfolioUrl: created.portfolioUrl || created.portalUrl,
      isPublic: created.isPublic ?? true,
      documentCount: 0,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
    setPortals(prev => [newPortal, ...prev]);
    setSelectedPortal(newPortal);
    return newPortal;
  }, [getClient]);

  const deletePortal = useCallback(async (portalId: string) => {
    const client = getClient();
    await client.deletePortfolio(portalId);
    setPortals(prev => prev.filter(p => p.id !== portalId));
    setSelectedPortal(prev => (prev?.id === portalId ? null : prev));
    setPortalDocuments([]);
    setPortalCrawls([]);
  }, [getClient]);

  const value = useMemo(() => ({
    portals,
    selectedPortal,
    portalDocuments,
    portalCrawls,
    isLoadingPortals,
    isLoadingDocuments,
    isLoadingCrawls,
    portalError,
    setSelectedPortal,
    setPortalError,
    loadPortals,
    loadPortalDocuments,
    loadPortalCrawls,
    createPortal,
    deletePortal,
  }), [
    portals,
    selectedPortal,
    portalDocuments,
    portalCrawls,
    isLoadingPortals,
    isLoadingDocuments,
    isLoadingCrawls,
    portalError,
    setSelectedPortal,
    loadPortals,
    loadPortalDocuments,
    loadPortalCrawls,
    createPortal,
    deletePortal,
  ]);

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
};

export const usePortal = () => {
  const context = useContext(PortalContext);
  if (!context) {
    throw new Error('usePortal must be used within a PortalProvider');
  }
  return context;
};

