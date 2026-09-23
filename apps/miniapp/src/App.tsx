import { CellHeader, CellList, CellSimple, Container, Panel, Typography } from '@maxhub/max-ui';

// Заглушка: настоящие экраны появятся по тикетам.
export function App() {
  const platform = window.WebApp?.platform ?? 'браузер (моста MAX нет)';
  const version = window.WebApp?.version ?? '—';

  return (
    <Panel mode="secondary">
      <Container>
        <Typography.Headline variant="large-strong">MaxTown</Typography.Headline>
        <Typography.Body variant="medium">Каркас мини-аппа. Экраны появятся по тикетам.</Typography.Body>
      </Container>
      <CellList mode="island" header={<CellHeader titleStyle="caps">Окружение</CellHeader>}>
        <CellSimple title="Платформа" subtitle={platform} />
        <CellSimple title="Версия моста" subtitle={version} />
      </CellList>
    </Panel>
  );
}
