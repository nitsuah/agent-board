import { useState, useRef, useEffect } from 'react';
import { toast } from '../components/Toast.jsx';

export function useServiceActions({ dockerStatus, systemServices }) {
  const [serviceActionsInFlight, setServiceActionsInFlight] = useState({});
  const [serviceActionErrors, setServiceActionErrors] = useState({});
  const [servicesStarting, setServicesStarting] = useState({});
  const startingTimeoutsRef = useRef({});
  const [modelPulls, setModelPulls] = useState({});
  const [knownModels, setKnownModels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agent_board_pulled_models') || '{}'); } catch { return {}; }
  });
  const [contentClients, setContentClients] = useState([]);
  const [contentFiles, setContentFiles] = useState({});
  const [contentExpanded, setContentExpanded] = useState({});

  // Fast-poll while any service is starting up
  useEffect(() => {
    const anyStarting = Object.values(servicesStarting).some(Boolean);
    if (!anyStarting) return;
    const poll = setInterval(() => {
      fetch('/api/docker/status').catch(() => {});
      fetch('/api/system/services').catch(() => {});
    }, 2000);
    return () => clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicesStarting]);

  // Clear starting state once service is confirmed running
  useEffect(() => {
    setServicesStarting(prev => {
      const startingKeys = Object.keys(prev).filter(k => prev[k]);
      if (startingKeys.length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const key of startingKeys) {
        if (dockerStatus?.containers?.[key]?.running || systemServices?.services?.[key]?.running) {
          next[key] = false;
          changed = true;
          clearTimeout(startingTimeoutsRef.current[key]);
          delete startingTimeoutsRef.current[key];
        }
      }
      return changed ? next : prev;
    });
  }, [dockerStatus, systemServices]);

  const runServiceAction = async (serviceKey, action, { fetchDockerStatus, fetchSystemServices } = {}) => {
    const actionId = `${serviceKey}:${action}`;
    setServiceActionsInFlight(prev => ({ ...prev, [actionId]: true }));
    setServiceActionErrors(prev => ({ ...prev, [serviceKey]: null }));
    try {
      const res = await fetch(`/api/system/services/${serviceKey}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Service action failed');
        setServiceActionErrors(prev => ({ ...prev, [serviceKey]: data.error || 'Action failed' }));
      } else if (action === 'start') {
        setServicesStarting(prev => ({ ...prev, [serviceKey]: true }));
        clearTimeout(startingTimeoutsRef.current[serviceKey]);
        startingTimeoutsRef.current[serviceKey] = setTimeout(() => {
          setServicesStarting(prev => ({ ...prev, [serviceKey]: false }));
          delete startingTimeoutsRef.current[serviceKey];
        }, 90000);
      }
      await Promise.all([fetchDockerStatus?.(), fetchSystemServices?.()]);
    } catch (error) {
      toast.error(`Service action failed: ${error.message}`);
      setServiceActionErrors(prev => ({ ...prev, [serviceKey]: error.message }));
    } finally {
      setServiceActionsInFlight(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const fetchModelPullStatus = async () => {
    try {
      const res = await fetch('/api/models/pull-status');
      const data = await res.json();
      if (data.success) setModelPulls(data.pulls || {});
    } catch (error) { console.error('Error fetching model pull status:', error); }
  };

  const pullModel = async (endpoint, model) => {
    const pullKey = `${endpoint}:${model}`;
    const actionId = `pull:${pullKey}`;
    setServiceActionsInFlight(prev => ({ ...prev, [actionId]: true }));
    setServiceActionErrors(prev => ({ ...prev, [actionId]: null }));
    try {
      const res = await fetch('/api/models/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, model }),
      });
      const data = await res.json();
      if (!data.success) {
        setServiceActionErrors(prev => ({ ...prev, [actionId]: data.error || 'Pull failed' }));
      } else {
        const record = { endpointKey: endpoint, model, pulledAt: new Date().toISOString() };
        setKnownModels(prev => {
          const next = { ...prev, [pullKey]: record };
          try { localStorage.setItem('agent_board_pulled_models', JSON.stringify(next)); } catch { /* storage full */ }
          return next;
        });
      }
      await fetchModelPullStatus();
    } catch (error) {
      setServiceActionErrors(prev => ({ ...prev, [actionId]: error.message }));
    } finally {
      setServiceActionsInFlight(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const unloadDockerModel = async (model) => {
    try {
      const res = await fetch('/api/models/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      if (!data.success) toast.error(data.error || 'Unload failed');
    } catch (err) { toast.error(`Unload error: ${err.message}`); }
  };

  const fetchContentClients = async () => {
    try {
      const res = await fetch('/api/content/clients');
      const data = await res.json();
      if (data.success) setContentClients(data.clients || []);
    } catch { /* ignore */ }
  };

  const fetchContentFiles = async (slug) => {
    try {
      const res = await fetch(`/api/content/clients/${encodeURIComponent(slug)}/files`);
      const data = await res.json();
      if (data.success) setContentFiles(prev => ({ ...prev, [slug]: data.files || [] }));
    } catch { /* ignore */ }
  };

  const downloadContentFile = (slug, filePath) => {
    const url = `/api/content/download/${encodeURIComponent(slug)}/${filePath}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop();
    a.click();
  };

  return {
    serviceActionsInFlight, serviceActionErrors, servicesStarting,
    modelPulls, setModelPulls, knownModels,
    contentClients, contentFiles, contentExpanded, setContentExpanded,
    runServiceAction, fetchModelPullStatus, pullModel, unloadDockerModel,
    fetchContentClients, fetchContentFiles, downloadContentFile,
  };
}
