import { ChatCircleText, Plus } from '@phosphor-icons/react';
import { Button, IconButton, Typography } from '../components/platform-ui.tsx';
import { EmptyState, ErrorState, ListCard, RowShell, ScreenHeading, SkeletonRows } from '../components/ui.tsx';
import { useMembership } from '../auth/membership.tsx';
import { useManagementQuestions } from '../data/managementQuestions.ts';
import { formatUpdatedAt } from '../data/labels.ts';
import { managementQuestionRoute, ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

const labels = {
  'waiting-for-answer': 'Ждёт ответа',
  answered: 'Есть ответ',
  closed: 'Закрыт',
} as const;

const tones = {
  'waiting-for-answer': 'themed',
  answered: 'positive',
  closed: 'neutral',
} as const;

export function ManagementQuestionsScreen({ navigate }: { navigate: Navigate }) {
  const { status, data, retry } = useManagementQuestions();
  const role = useMembership()?.role;
  const canCreate = role === 'resident' || role === 'admin';
  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <div className="heading-row">
          <ScreenHeading description="Публичные вопросы и официальные ответы управляющей компании">Приёмная УК</ScreenHeading>
          {canCreate ? <IconButton aria-label="Задать вопрос УК" onClick={() => navigate(ROUTES.newManagementQuestion)}><Plus className="icon" weight="bold" aria-hidden /></IconButton> : null}
        </div>
        {status === 'ready' && !data.managementAssigned ? (
          <div className="management-info" role="status"><ChatCircleText className="icon icon--small" aria-hidden /><p>УК ещё не подключена. Новые вопросы сохранятся и придут ей после назначения.</p></div>
        ) : null}
        {status === 'loading' ? <SkeletonRows count={5} /> : status === 'error' ? <ErrorState onRetry={retry} /> : data.questions.length > 0 ? (
          <ListCard label="Вопросы в УК">
            {data.questions.map((question) => (
              <RowShell key={question.id} onOpen={() => navigate(managementQuestionRoute(question.id))}>
                <span className="list-row__copy">
                  <Typography.Text asChild variant="body-strong"><span className="list-row__title">{question.title}</span></Typography.Text>
                  <Typography.Text asChild variant="description" color="secondary"><span>{question.authorName}</span></Typography.Text>
                  <span className="list-row__meta">
                    <span className={`status-badge status-badge--${tones[question.state]}`}>{labels[question.state]}</span>
                    <Typography.Text asChild variant="description" color="tertiary"><time dateTime={question.updatedAt}>{formatUpdatedAt(question.updatedAt)}</time></Typography.Text>
                  </span>
                </span>
              </RowShell>
            ))}
          </ListCard>
        ) : (
          <div className="list-card"><EmptyState icon={ChatCircleText} tone="blue" title="Вопросов пока нет" description="Спросите УК об отоплении, начислениях или планах работ" action={canCreate ? <Button size="small" onClick={() => navigate(ROUTES.newManagementQuestion)}>Задать вопрос</Button> : undefined} /></div>
        )}
      </div>
    </main>
  );
}
