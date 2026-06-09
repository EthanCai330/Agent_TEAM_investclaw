import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  applyAgentClusterManagerProposal,
  createAgentClusterAgent,
  createAgentCluster,
  confirmAgentClusterExecutionGraph,
  deleteAgentCluster,
  dismissAgentClusterManagerProposal,
  getAgentClusterCreationStatus,
  getAgentCluster,
  listAgentClusters,
  pauseAgentClusterRun,
  refreshAgentClusterRunEvents,
  resumeAgentClusterRun,
  resetAgentClusterRun,
  rollbackAgentClusterWorkflow,
  resumeAgentClusterRunFromAgent,
  retryAgentClusterRunAgent,
  decideAgentClusterHumanGate,
  sendAgentClusterManagerMessage,
  skipAgentClusterRunAgent,
  startAgentClusterRun,
  stopAgentClusterRun,
  sendAgentClusterMessage,
  updateAgentCluster,
  updateAgentClusterExecutionGraph,
  updateAgentClusterWorkflow,
  confirmAgentClusterWorkflow,
  type CreateAgentClusterAgentInput,
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

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/agents') && req.method === 'POST') {
    try {
      const clusterId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/'.length, -'/agents'.length));
      const body = await parseJsonBody<CreateAgentClusterAgentInput>(req);
      const cluster = await createAgentClusterAgent(clusterId, body);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
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

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/workflow') && req.method === 'PATCH') {
    try {
      const clusterId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/'.length, -'/workflow'.length));
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const cluster = await updateAgentClusterWorkflow(clusterId, body);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/workflow/confirm') && req.method === 'POST') {
    try {
      const clusterId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/'.length, -'/workflow/confirm'.length));
      const body = await parseJsonBody<{ workflowId?: string }>(req);
      const cluster = await confirmAgentClusterWorkflow(clusterId, body.workflowId);
      sendJson(res, 200, { success: true, cluster });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/workflow/rollback') && req.method === 'POST') {
    try {
      const clusterId = decodeURIComponent(url.pathname.slice('/api/agent-clusters/'.length, -'/workflow/rollback'.length));
      const body = await parseJsonBody<{ workflowId?: string }>(req);
      if (!body.workflowId) throw new Error('workflowId is required');
      const cluster = await rollbackAgentClusterWorkflow(clusterId, body.workflowId);
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

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/pause') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/pause'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run pause route');
      const cluster = await pauseAgentClusterRun(
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

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/resume') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/resume'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run resume route');
      const cluster = await resumeAgentClusterRun(
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

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/stop') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/stop'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid run stop route');
      const cluster = await stopAgentClusterRun(
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

  if (url.pathname.startsWith('/api/agent-clusters/') && url.pathname.endsWith('/human-gate') && req.method === 'POST') {
    try {
      const rest = url.pathname.slice('/api/agent-clusters/'.length, -'/human-gate'.length);
      const [clusterIdRaw, runsSegment, runIdRaw] = rest.split('/');
      if (runsSegment !== 'runs' || !runIdRaw) throw new Error('Invalid human gate route');
      const body = await parseJsonBody<{ nodeId?: string; decision?: 'approve' | 'reject' }>(req);
      if (!body.nodeId || (body.decision !== 'approve' && body.decision !== 'reject')) throw new Error('nodeId and decision are required');
      const cluster = await decideAgentClusterHumanGate(
        decodeURIComponent(clusterIdRaw),
        decodeURIComponent(runIdRaw),
        body.nodeId,
        body.decision,
        ctx.gatewayManager,
        ctx.eventBus,
      );
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
