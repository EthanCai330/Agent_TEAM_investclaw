import { completeSetup, expect, test } from './fixtures/electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test.describe('InvestClaw Agent Cluster', () => {
  test('creates a cluster from a new task and opens the concise workflow view', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-agent-clusters').click();
    await expect(page.getByTestId('agent-clusters-page')).toBeVisible();
    await expect(page.getByTestId('agent-clusters-title')).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    });
    const taskGoalBackground = await page.getByTestId('agent-cluster-task-goal')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(taskGoalBackground).not.toBe('rgb(255, 255, 255)');
    expect(taskGoalBackground).not.toBe('rgba(255, 255, 255, 1)');

    await page.getByTestId('agent-cluster-task-goal').fill('为 AI 半导体主题创建一个多 Agent 投研流程，包含研究、执行、审查和汇总。');
    await page.getByTestId('agent-cluster-create-button').click();

    await expect(page.getByTestId('agent-cluster-detail-page')).toBeVisible();
    await expect(page.getByTestId('agent-cluster-workflow-editor')).toBeVisible();
    await expect(page.getByTestId('agent-cluster-workflow-overview')).toBeVisible();
    await expect(page.getByText(/Harness Workflow v1/)).toBeVisible();
    const workflowAgents = page.locator('[data-testid^="workflow-agent-node-"]');
    expect(await workflowAgents.count()).toBeGreaterThanOrEqual(4);
    const nodeBoxes = await workflowAgents.evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    for (let index = 0; index < nodeBoxes.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < nodeBoxes.length; otherIndex += 1) {
        const first = nodeBoxes[index];
        const second = nodeBoxes[otherIndex];
        const overlaps = first.left < second.right
          && first.right > second.left
          && first.top < second.bottom
          && first.bottom > second.top;
        expect(overlaps).toBe(false);
      }
    }
    const sidebarMaterial = await page.getByTestId('sidebar').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
        platform: window.electron?.platform,
      };
    });
    expect(sidebarMaterial.backgroundColor).toMatch(/rgba?\(/);
    expect(sidebarMaterial.backgroundColor).not.toMatch(/,\s*1\)$/);
    await expect(page.getByTestId('titlebar')).toBeVisible();
    const titlebarMaterial = await page.getByTestId('titlebar').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
      };
    });
    expect(titlebarMaterial.backgroundColor).not.toMatch(/,\s*1\)$/);
    if (sidebarMaterial.platform === 'darwin') {
      expect(sidebarMaterial.backdropFilter).toBe('none');
      expect(titlebarMaterial.backdropFilter).toBe('none');
      const alpha = Number(sidebarMaterial.backgroundColor.match(/,\s*([\d.]+)\)$/)?.[1] ?? '1');
      expect(alpha).toBeLessThanOrEqual(0.08);
      const darkMaterial = await page.getByTestId('sidebar').evaluate((element) => {
        const root = document.documentElement;
        const previousClasses = root.className;
        root.classList.remove('light');
        root.classList.add('dark');
        const backgroundColor = getComputedStyle(element).backgroundColor;
        root.className = previousClasses;
        return backgroundColor;
      });
      expect(darkMaterial).toMatch(/rgba?\(10,\s*10,\s*12,\s*0\.08\)/);
    } else {
      expect(sidebarMaterial.backdropFilter).not.toBe('none');
      expect(titlebarMaterial.backdropFilter).not.toBe('none');
    }
    await expect(page.getByTestId('main-content')).toHaveCSS('background-color', /rgb/);

    await expect(page.getByTestId('agent-cluster-conversation')).toBeVisible();
    await expect(page.getByTestId('sidebar-section-agent-clusters')).toBeVisible();
    await expect(page.getByRole('heading', { name: '集群1' })).toBeVisible();
    await expect(page.locator('[data-testid^="sidebar-agent-cluster-"]').first()).toContainText('集群1');
    await expect(page.getByText('任务规划 Agent').first()).toBeVisible();
    await expect(page.getByText('待确认流水线').first()).toBeVisible();
    await expect(page.getByTestId('agent-cluster-agent-rail')).toBeVisible();
    await expect(page.getByTestId('agent-cluster-resize-left')).toBeVisible();
    await expect(page.getByTestId('agent-cluster-resize-right')).toBeVisible();

    await page.getByTestId('agent-cluster-message-input').fill('请让 Agent B 后续只生成 LLM 因子，不要使用模板枚举。');
    await page.getByTestId('agent-cluster-send-button').click();
    await expect(page.getByTestId('agent-cluster-manager-proposal')).toBeVisible();
    await expect(page.getByRole('button', { name: '应用提案' })).toBeVisible();
    await page.getByRole('button', { name: '应用提案' }).click();
    await expect(page.getByText('Manager 提案已应用').first()).toBeVisible();

    await page.getByRole('button', { name: /确认流水线/ }).click();
    await expect(page.getByText('流水线已确认').first()).toBeVisible();
    await page.getByTestId('agent-cluster-start-run').click();
    await expect(page.getByTestId('agent-cluster-run-monitor')).toBeVisible();
    await expect(page.getByText(/Workflow v1/).first()).toBeVisible();
    await expect(page.getByText(/准备启动子会话|提交子会话/).first()).toBeVisible();
  });

  test('creates a project-folder cluster and supports renaming it', async ({ page, homeDir }) => {
    const projectDir = join(homeDir, 'factor_mining_v1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'README.md'), '# Factor Mining\n\n6-step pipeline with Agent A/B/C/D.');
    await writeFile(join(projectDir, 'HANDOFF.MD'), 'Agent A 数据管家，Agent B 因子生成器，Agent C 评估审计官，Agent D 研究馆员。');

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-agent-clusters').click();
    await page.getByText('基于现有任务创建').click();
    await expect(page.getByTestId('agent-cluster-file-path')).toHaveJSProperty('type', 'text');
    await expect(page.getByTestId('agent-cluster-folder-path')).toHaveJSProperty('type', 'text');
    await page.evaluate(() => {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
    });
    for (const testId of ['agent-cluster-markdown', 'agent-cluster-file-path', 'agent-cluster-folder-path']) {
      const background = await page.getByTestId(testId).evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(background).not.toBe('rgb(255, 255, 255)');
      expect(background).not.toBe('rgba(255, 255, 255, 1)');
    }
    await page.getByTestId('agent-cluster-folder-path').fill(projectDir);
    await page.getByTestId('agent-cluster-create-button').click();

    await expect(page.getByTestId('agent-cluster-detail-page')).toBeVisible();
    await expect(page.getByTestId('sidebar-section-agent-clusters')).toBeVisible();
    await expect(page.getByTestId('sidebar-section-project-folders')).toBeVisible();
    await expect(page.getByTestId('sidebar-section-unfiled-chats')).toBeVisible();
    await expect(page.locator('[data-testid^="sidebar-project-folder-"]').first()).toContainText('factor_mining_v1');
    await expect(page.getByText('factor_mining_v1').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '集群1' })).toBeVisible();
    const sidebarCluster = page.locator('[data-testid^="sidebar-agent-cluster-"]').first();
    await sidebarCluster.hover();
    await page.locator('[data-testid^="sidebar-agent-cluster-pin-"]').click();
    await page.reload();
    await expect(page.locator('[data-testid^="sidebar-agent-cluster-pin-"]').first()).toHaveAttribute('aria-label', 'Unpin cluster');

    await page.getByTestId('sidebar-section-agent-clusters-toggle').click();
    await expect(page.locator('[data-testid^="sidebar-agent-cluster-"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-testid^="sidebar-agent-cluster-"]')).toHaveCount(0);
    await page.getByTestId('sidebar-section-agent-clusters-toggle').click();
    await expect(page.locator('[data-testid^="sidebar-agent-cluster-"]').first()).toBeVisible();

    const projectFolder = page.locator('[data-testid^="sidebar-project-folder-"]').first();
    await projectFolder.hover();
    await page.locator('[data-testid^="sidebar-project-folder-remove-"]').click();
    const removeProjectDialog = page.getByRole('dialog');
    await expect(removeProjectDialog).toBeVisible();
    await removeProjectDialog.getByRole('button', { name: '移除' }).click();
    await expect(page.locator('[data-testid^="sidebar-project-folder-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sidebar-agent-cluster-"]').first()).toContainText('集群1');
    await page.getByTestId('sidebar-restore-project-folders').click();
    await expect(page.locator('[data-testid^="sidebar-project-folder-"]').first()).toContainText('factor_mining_v1');

    await page.getByLabel('重命名集群').click();
    await page.locator('input[value="集群1"]').fill('因子研究集群');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: '因子研究集群' })).toBeVisible();
    await expect(page.locator('[data-testid^="sidebar-agent-cluster-"]').first()).toContainText('因子研究集群');

    await page.locator('[data-testid^="sidebar-agent-cluster-"]').first().hover();
    await page.getByLabel('Delete cluster').click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /^(Delete|删除)$/ }).click();

    await expect(page.locator('[data-testid^="sidebar-agent-cluster-"]')).toHaveCount(0);
  });
});
