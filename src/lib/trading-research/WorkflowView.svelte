<script lang="ts">
  import ModuleCard from "../../components/ModuleCard.svelte";

  import Badge from "./Badge.svelte";
  import PanelHeading from "./PanelHeading.svelte";
  import SectionHeading from "./SectionHeading.svelte";
  import WorkbenchIcon from "./WorkbenchIcon.svelte";
  import { workflowDemos } from "./demo-data";
</script>

<div class="tr-view-stack">
  <section aria-labelledby="workflow-compose-title">
    <SectionHeading id="workflow-compose-title" title="新建流程" />
    <div class="tr-workflow-compose-grid">
      <article class="tr-workflow-composer">
        <div class="tr-workflow-composer__head">
          <span class="tr-flow-icon tr-flow-icon--trade" aria-hidden="true"><WorkbenchIcon name="trading" /></span>
          <div><span>交易流程</span><h3>创建交易草稿</h3></div>
        </div>
        <label>
          <span>自然语言描述</span>
          <textarea readonly rows="4">2026年8月7日，与招商银行开展5亿元7天同业拆借，利率1.85%。</textarea>
        </label>
        <div class="tr-form-row">
          <label><span>业务编号</span><input readonly value="T20260807001" /></label>
          <label><span>标题</span><input readonly value="招商银行 7D 同业拆借" /></label>
        </div>
        <div class="tr-form-footer"><small>创建后由交易员确认并提交投资经理复核</small><button type="button" disabled>创建草稿</button></div>
      </article>

      <article class="tr-workflow-composer">
        <div class="tr-workflow-composer__head">
          <span class="tr-flow-icon tr-flow-icon--credit" aria-hidden="true"><WorkbenchIcon name="credit" /></span>
          <div><span>授信周报</span><h3>创建周报草稿</h3></div>
        </div>
        <label>
          <span>自然语言描述</span>
          <textarea readonly rows="4">截至2026年8月21日，授信总额度3448.35亿元，已使用1022.5955亿元，可用额度2425.7545亿元。</textarea>
        </label>
        <div class="tr-form-row">
          <label><span>周报批次</span><input readonly value="CREDIT-20260821" /></label>
          <label><span>标题</span><input readonly value="授信周报（截至2026-08-21）" /></label>
        </div>
        <div class="tr-form-footer"><small>主管通过后，授信专员可导出周报</small><button type="button" disabled>创建草稿</button></div>
      </article>
    </div>
  </section>

  <ModuleCard labelledBy="workflow-list-title">
    <PanelHeading id="workflow-list-title" title="我的流程与待办复核">
      <Badge tone="info">{workflowDemos.length} 条任务</Badge>
    </PanelHeading>
    <div class="tr-workflow-list">
      {#each workflowDemos as workflow}
        <article>
          <div class="tr-workflow-task__head">
            <div><span>{workflow.type}</span><h3>{workflow.title}</h3><p>{workflow.businessKey} · {workflow.detail}</p></div>
            <Badge tone="warning">{workflow.state}</Badge>
          </div>
          <ol class="tr-workflow-steps" aria-label={`${workflow.title}流程进度`}>
            {#each workflow.steps as step, index}
              <li class:completed={index < workflow.currentStep} class:current={index === workflow.currentStep}>
                <span aria-hidden="true">
                  {#if index < workflow.currentStep}
                    <WorkbenchIcon name="check" />
                  {:else}
                    {index + 1}
                  {/if}
                </span>
                <strong>{step}</strong>
              </li>
            {/each}
          </ol>
          <div class="tr-workflow-task__footer"><small>版本 1</small><button type="button" disabled>查看任务</button></div>
        </article>
      {/each}
    </div>
  </ModuleCard>
</div>
