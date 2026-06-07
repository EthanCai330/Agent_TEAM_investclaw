import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  applyAgentClusterManagerProposal,
  createAgentCluster,
  confirmAgentClusterExecutionGraph,
  deleteAgentCluster,
  dismissAgentClusterManagerProposal,
  getAgentClusterCreationStatus,
  getAgentCluster,
  listAgentClusters,
  refreshAgentClusterRunEvents,
  resetAgentClusterRun,
  resumeAgentClusterRunFromAgent,
  retryAgentClusterRunAgent,
  sendAgentClusterManagerMessage,
  skipAgentClusterRunAgent,
  startAgentClusterRun,
  sendAgentClusterMessage,
  updateAgentCluster,
  updateAgentClusterExecutionGraph,
  type CreateAgentClusterInput,
  type SendAgentClusterMessageInput,
  type SendAgentClusterManagerMessageInput,
} from '../../utils/agent-clusters';

export async function handleAgentClusterRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agent-clusters' && req.method === 'GET') {
    sendJson(res, 200, { success: true, clusters: await listAgentClusters() });
    return true;
  }

  if (url.pathname === '/api/agent-clusters' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<CreateAgentClusterInput>(req);
      const cluster = await createAgentCluster(body, (status) => {
        const payload = { status };
        ctx.eventBus.emit('agent-cluster:creation-updated', payload);
        if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
          ctx.mainWindow.webContents.send('agent-cluster:creation-updated', payload);
        }
      });
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/creation-status/') && req.method === 'GET') {
    const requestId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/creation-status/'.length));
    const status = getAgentClusterCreationStatus(requestId);
    sendJson(res, status ? 200 : 404, status ? { success: true, status } : { success: false, error: 'Creation status not found' });
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/runs') && req.method === 'POST') {
    try {
      const clusterId = decodeURIComponent(
        url.pathname.slice('/api/agent-clusters/'.length, -'/runs'.length),
      );
      const cluster = await startAgentClusterRun(clusterId, ctx.gatewayManager, ctx.eventBus);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/execution-graph') && req.method === 'PATCH') {
    try {
      const clusterId = decodeURIComponent(
        url.pathname.slice('/api/agent-clusters/'.length, -'/execution-graph'.length),
      );
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const cluster = await updateAgentClusterExecutionGraph(clusterId, body);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/execution-graph/confirm') && req.method === 'POST') {
    try {
      const clusterId = decodeURIComponent(
        url.pathname.slice('/api/agent-clusters/'.length, -'/execution-graph/confirm'.length),
      );
      const cluster = await confirmAgentClusterExecutionGraph(clusterId);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/refresh-events') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/refresh-events'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run refresh route');
      const cluster = await refreshAgentClusterRunEvents(
        decodeURIComponent(clusterIdRaw),
        decodeURIComponent(runIdRaw),
        ctx.gatewayManager,
        ctx.eventBus,
      );
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/reset') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/reset'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run reset route');
      const cluster = await resetAgentClusterRun(decodeURIComponent(clusterIdRaw), decodeURIComponent(runIdRaw));
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/resume-from-agent') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/resume-from-agent'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run resume route');
      const body = await parseJsonBody<{ agentId?: string }>(req);
      if (!body.agentId) throw new Error('agentId is required');
      const cluster = await resumeAgentClusterRunFromAgent(
        decodeURIComponent(clusterIdRaw),
        decodeURIComponent(runIdRaw),
        body.agentId,
        ctx.gatewayManager,
        ctx.eventBus,
      );
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/retry-agent') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/retry-agent'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run retry route');
      const body = await parseJsonBody<{ agentId?: string }>(req);
      if (!body.agentId) throw new Error('agentId is required');
      const cluster = await retryAgentClusterRunAgent(
        decodeURIComponent(clusterIdRaw),
        decodeURIComponent(runIdRaw),
        body.agentId,
        ctx.gatewayManager,
        ctx.eventBus,
      );
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/skip-agent') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/skip-agent'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run skip route');
      const body = await parseJsonBody<{ agentId?: string }>(req);
      if (!body.agentId) throw new Error('agentId is required');
      const cluster = await skipAgentClusterRunAgent(
        decodeURIComponent(clusterIdRaw),
        decodeURIComponent(runIdRaw),
        body.agentId,
        ctx.gatewayManager,
        ctx.eventBus,
      );
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && req.method === 'PATCH') {
    try {
      const clusterId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/'.length));
      const body = await parseJsonBody<{ clusterName?: string }>(req);
      const cluster = await updateAgentCluster(clusterId, body);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && req.method === 'DELETE') {
    try {
      const clusterId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/'.length));
      await deleteAgentCluster(clusterId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && req.method === 'GET') {
    const clusterId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/'.length));
    const cluster = await getAgentCluster(clusterId);
    if (!cluster) {
      sendJson(res, 404, { success: false, error: 'Agent Cluster not found' });
      return true;
    }
    sendJson(res, 200, { success: true, cluster });
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/manager/messages') && req.method === 'POST') {
    try {
      const clusterId = decodeURIComponent(
        url.pathname.slice('/api/agent-clusters/'.length, -'/manager/messages'.length),
      );
      const body = await parseJsonBody<SendAgentClusterManagerMessageInput>(req);
      const cluster = await sendAgentClusterManagerMessage(clusterId, body, ctx.gatewayManager, ctx.eventBus);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.includes('/manager/proposals/') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length);
      const [clusterIdRaw, managerSegment, proposalsSegment, proposalIdRaw, action] = rest.split('/');
      if (managerSegment !== 'manager' || proposalsSegment !== 'proposals' || !proposalIdRaw) {
        throw new Error('Invalid manager proposal route');
      }
      const clusterId = decodeURIComponent(clusterIdRaw);
      const proposalId = decodeURIComponent(proposalIdRaw);
      const cluster = action === 'apply'
        ? await applyAgentClusterManagerProposal(clusterId, proposalId)
        : action === 'dismiss'
          ? await dismissAgentClusterManagerProposal(clusterId, proposalId)
          : null;
      if (!cluster) throw new Error('Invalid manager proposal action');
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/messages') && req.method === 'POST') {
    try {
      const clusterId = decodeURIComponent(
        url.pathname.slice('/api/agent-clusters/'.length, -'/messages'.length),
      );
      const body = await parseJsonBody<SendAgentClusterMessageInput>(req);
      const cluster = await sendAgentClusterMessage(clusterId, body);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  return false;
}
