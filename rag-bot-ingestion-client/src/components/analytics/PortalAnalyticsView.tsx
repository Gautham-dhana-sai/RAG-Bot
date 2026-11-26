import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Portal,
  AnalyticsFilterParams,
  PortalAnalyticsOverview,
  SourceAnalyticsData,
  ProcessingPerformanceData,
  AITokenConsumptionData,
  ChatUsageData,
  SourceActivityData,
  FailureAnalyticsData,
} from '../../types';
import { IngestionApiClient } from '../../api';
import { AnalyticsFilters } from './AnalyticsFilters';
import { AnalyticsOverviewCards } from './AnalyticsOverviewCards';
import { SourceAnalyticsSection } from './SourceAnalyticsSection';
import { PerformanceSection } from './PerformanceSection';
import { AiConsumptionSection } from './AiConsumptionSection';
import { ChatUsageSection } from './ChatUsageSection';
import { SourceActivitySection } from './SourceActivitySection';
import { FailureAnalyticsSection } from './FailureAnalyticsSection';

interface PortalAnalyticsViewProps {
  portal: Portal;
  apiClient: IngestionApiClient;
}

type AnalyticsSubTab = 'overview' | 'sources' | 'performance' | 'tokens' | 'chat' | 'activity' | 'failures';
const VALID_SUBTABS: AnalyticsSubTab[] = ['overview', 'sources', 'performance', 'tokens', 'chat', 'activity', 'failures'];

function parseSubTab(raw?: string | null): AnalyticsSubTab | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^#\/?(analytics\/)?/i, '').toLowerCase() as AnalyticsSubTab;
  return VALID_SUBTABS.includes(cleaned) ? cleaned : null;
}

export const PortalAnalyticsView: React.FC<PortalAnalyticsViewProps> = ({
  portal,
  apiClient,
}) => {
  const { portalId, subTab: pathSubTab } = useParams<{ portalId: string; tab?: string; subTab?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const resolvedSubTab: AnalyticsSubTab =
    parseSubTab(pathSubTab) ||
    parseSubTab(searchParams.get('subTab')) ||
    parseSubTab(location.hash) ||
    'overview';

  const [filters, setFilters] = useState<AnalyticsFilterParams>({ period: '30d' });
  const [activeSubTab, setActiveSubTab] = useState<AnalyticsSubTab>(resolvedSubTab);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active tab data states (decomposed when switching out)
  const [overview, setOverview] = useState<PortalAnalyticsOverview | null>(null);
  const [sourceAnalytics, setSourceAnalytics] = useState<SourceAnalyticsData | null>(null);
  const [performance, setPerformance] = useState<ProcessingPerformanceData | null>(null);
  const [tokenConsumption, setTokenConsumption] = useState<AITokenConsumptionData | null>(null);
  const [chatUsage, setChatUsage] = useState<ChatUsageData | null>(null);
  const [sourceActivity, setSourceActivity] = useState<SourceActivityData | null>(null);
  const [failureAnalytics, setFailureAnalytics] = useState<FailureAnalyticsData | null>(null);

  // Reference for API calls (ID or slug or portfolioUrl)
  const portalRef = portal.id || portal.slug || portal.portfolioUrl || portal.portalUrl;

  // Keep state synced when URL changes (e.g. browser back/forward or deep-link reload)
  useEffect(() => {
    if (resolvedSubTab !== activeSubTab) {
      setOverview(null);
      setSourceAnalytics(null);
      setPerformance(null);
      setTokenConsumption(null);
      setChatUsage(null);
      setSourceActivity(null);
      setFailureAnalytics(null);
      setError(null);
      setActiveSubTab(resolvedSubTab);
    }
  }, [resolvedSubTab, activeSubTab]);

  // Clear previous tab's data when tab changes to decompose state and update URL
  const handleTabChange = useCallback((newTab: AnalyticsSubTab) => {
    if (newTab === activeSubTab) return;
    // Decompose all previous tab states immediately
    setOverview(null);
    setSourceAnalytics(null);
    setPerformance(null);
    setTokenConsumption(null);
    setChatUsage(null);
    setSourceActivity(null);
    setFailureAnalytics(null);
    setError(null);
    setActiveSubTab(newTab);

    const targetPortalId = portalId || portal.id;
    if (targetPortalId) {
      navigate(`/portals/${targetPortalId}/analytics/${newTab}${location.search}`);
    }
  }, [activeSubTab, portalId, portal.id, navigate, location.search]);

  // Fetch fresh data from API for the active tab
  const loadActiveTabContent = useCallback(async () => {
    if (!portalRef) return;
    setIsLoading(true);
    setError(null);

    try {
      switch (activeSubTab) {
        case 'overview': {
          const ov = await apiClient.getPortalAnalyticsOverview(portalRef, filters);
          setOverview(ov);
          break;
        }
        case 'sources': {
          const src = await apiClient.getPortalSourceAnalytics(portalRef, filters);
          setSourceAnalytics(src);
          break;
        }
        case 'performance': {
          const perf = await apiClient.getPortalProcessingPerformance(portalRef, filters);
          setPerformance(perf);
          break;
        }
        case 'tokens': {
          const tok = await apiClient.getPortalTokenConsumption(portalRef, filters);
          setTokenConsumption(tok);
          break;
        }
        case 'chat': {
          const chat = await apiClient.getPortalChatUsage(portalRef, filters);
          setChatUsage(chat);
          break;
        }
        case 'activity': {
          const act = await apiClient.getPortalSourceActivity(portalRef, { ...filters, page: 1, limit: 15 });
          setSourceActivity(act);
          break;
        }
        case 'failures': {
          const fail = await apiClient.getPortalFailureAnalytics(portalRef, { ...filters, page: 1, limit: 15 });
          setFailureAnalytics(fail);
          break;
        }
      }
    } catch (err: any) {
      console.error(`[PortalAnalyticsView] Failed to load ${activeSubTab} data:`, err);
      setError(err.message || `Failed to load ${activeSubTab} analytics.`);
    } finally {
      setIsLoading(false);
    }
  }, [apiClient, portalRef, activeSubTab, filters]);

  // Fetch fresh data whenever activeSubTab or filters change
  useEffect(() => {
    loadActiveTabContent();
  }, [loadActiveTabContent]);

  const handleFilterChange = useCallback((newFilters: AnalyticsFilterParams) => {
    setIsLoading(true);
    setOverview(null);
    setSourceAnalytics(null);
    setPerformance(null);
    setTokenConsumption(null);
    setChatUsage(null);
    setSourceActivity(null);
    setFailureAnalytics(null);
    setError(null);
    setFilters(newFilters);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setOverview(null);
    setSourceAnalytics(null);
    setPerformance(null);
    setTokenConsumption(null);
    setChatUsage(null);
    setSourceActivity(null);
    setFailureAnalytics(null);
    setError(null);
    loadActiveTabContent();
  }, [loadActiveTabContent]);

  const handleActivityPageChange = async (newPage: number) => {
    if (!portalRef) return;
    setIsLoading(true);
    try {
      const res = await apiClient.getPortalSourceActivity(portalRef, {
        ...filters,
        page: newPage,
        limit: 15,
      });
      setSourceActivity(res);
    } catch (err: any) {
      setError(err.message || 'Failed to change activity page.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFailurePageChange = async (newPage: number) => {
    if (!portalRef) return;
    setIsLoading(true);
    try {
      const res = await apiClient.getPortalFailureAnalytics(portalRef, {
        ...filters,
        page: newPage,
        limit: 15,
      });
      setFailureAnalytics(res);
    } catch (err: any) {
      setError(err.message || 'Failed to change failure page.');
    } finally {
      setIsLoading(false);
    }
  };

  const subTabs = [
    { id: 'overview', label: 'Overview', icon: '📊', desc: 'KPI summaries & health' },
    { id: 'sources', label: 'Sources', icon: '📚', desc: 'Outcomes, formats & volume' },
    { id: 'performance', label: 'Performance', icon: '⚡', desc: 'Stage durations & speeds' },
    { id: 'tokens', label: 'AI Tokens', icon: '🤖', desc: 'Models, prompt/output tokens' },
    { id: 'chat', label: 'Chatbot', icon: '💬', desc: 'Inquiries & response speed' },
    { id: 'activity', label: 'Activity', icon: '📝', desc: 'Source lifecycle history' },
    { id: 'failures', label: 'Failures', icon: '❌', desc: 'Root cause issue table' },
  ];

  return (
    <div style={{ padding: '0 0 40px 0', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
      {/* Title & Description Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text, #0f172a)', margin: 0 }}>
            {portal.name} Analytics
          </h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 0 0' }}>
            Operational metrics, ingestion outcomes, AI token consumption, and chatbot usage attribution for this portal.
          </p>
        </div>
      </div>

      {/* Global Filters: Preset periods, custom dates, timezone */}
      <AnalyticsFilters
        filters={filters}
        onChange={handleFilterChange}
        isLoading={isLoading}
        onRefresh={handleRefresh}
      />

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: '14px 18px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#b91c1c',
            fontSize: 13,
            marginBottom: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={handleRefresh}
            style={{
              padding: '4px 10px',
              backgroundColor: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Individual Separate Tabs Navigation Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          borderBottom: '2px solid var(--border, #e2e8f0)',
          marginBottom: 24,
        }}
      >
        {subTabs.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id as AnalyticsSubTab)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                border: 'none',
                borderBottom: isActive ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
                marginBottom: -2,
                backgroundColor: 'transparent',
                color: isActive ? 'var(--primary, #3b82f6)' : 'var(--text, #64748b)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Areas - Isolated, Loaded on Demand & Min Height to Prevent Scroll Jumps */}
      <div style={{ minHeight: 560, width: '100%' }}>
        {activeSubTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* High-level KPI summary cards */}
            <AnalyticsOverviewCards overview={overview} isLoading={isLoading} />

            {/* Quick navigation to individual sections */}
            <div style={{ marginTop: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: '0 0 14px 0' }}>
                Explore Analytics Sections
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                {subTabs.filter(t => t.id !== 'overview').map((tab) => (
                  <div
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id as AnalyticsSubTab)}
                    style={{
                      backgroundColor: 'var(--card-bg, #ffffff)',
                      border: '1px solid var(--border, #e2e8f0)',
                      borderRadius: 10,
                      padding: '16px 18px',
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                      transition: 'transform 0.15s, border-color 0.15s',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--primary, #3b82f6)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border, #e2e8f0)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{tab.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text, #1e293b)' }}>
                        {tab.label}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                        {tab.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeSubTab === 'sources' && (
          <SourceAnalyticsSection data={sourceAnalytics} isLoading={isLoading} />
        )}

        {activeSubTab === 'performance' && (
          <PerformanceSection data={performance} isLoading={isLoading} />
        )}

        {activeSubTab === 'tokens' && (
          <AiConsumptionSection data={tokenConsumption} isLoading={isLoading} />
        )}

        {activeSubTab === 'chat' && (
          <ChatUsageSection data={chatUsage} isLoading={isLoading} />
        )}

        {activeSubTab === 'activity' && (
          <SourceActivitySection
            data={sourceActivity}
            isLoading={isLoading}
            onPageChange={handleActivityPageChange}
          />
        )}

        {activeSubTab === 'failures' && (
          <FailureAnalyticsSection
            data={failureAnalytics}
            isLoading={isLoading}
            onPageChange={handleFailurePageChange}
          />
        )}
      </div>
    </div>
  );
};
