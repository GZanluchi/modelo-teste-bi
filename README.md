# IFC Viewer 3D para Power BI

Visual customizado para abrir modelos IFC dentro de relatórios Power BI, navegar em 3D e fazer seleção cruzada entre elementos BIM e os demais visuais.

## Funcionalidades

- Abre IFC por URL HTTPS ou por upload local.
- Orbit, zoom, pan, enquadramento e grade de referência.
- Clique em um objeto para obter `Express ID` e `GlobalId`.
- Seleção cruzada com outros visuais através do campo **ID do elemento IFC**.
- Tooltip textual associado ao elemento.
- Configurações de fundo, grade, barra de ferramentas e caminho do WASM.

## Preparação

Requisitos: Node.js LTS, Power BI Desktop e o modo de desenvolvedor de visuais habilitado.

```bash
npm install
npm run start
```

Para gerar o pacote:

```bash
npm run package
```

O arquivo final será criado em `dist/*.pbiviz`.

## Campos do visual

1. **URL do arquivo IFC**: uma URL HTTPS acessível pelo navegador e com CORS habilitado.
2. **ID do elemento IFC**: use `GlobalId` (recomendado) ou `Express ID`.
3. **Valor para cor**: reservado para evolução de coloração condicional.
4. **Tooltip**: texto exibido após clicar no elemento.

## Uso recomendado

- Hospede o `.ifc` e o `web-ifc.wasm` em um endpoint corporativo com HTTPS e CORS.
- No painel Formatar, informe o caminho do WASM. O valor padrão usa unpkg apenas para desenvolvimento.
- Para produção, prefira hospedar o WASM no mesmo domínio do IFC.
- O upload local é válido apenas durante a sessão atual. Para atualização e compartilhamento no Power BI Service, use URL.

## Limitações conhecidas do MVP

- A cor condicional está preparada no modelo de dados, mas ainda não cria subsets coloridos.
- Modelos muito grandes podem consumir memória significativa no navegador.
- URLs sem CORS ou bloqueadas por política organizacional não poderão ser abertas.
- A certificação AppSource exige revisão adicional de dependências, acesso externo e privacidade.

## Modelo de dados sugerido

Uma tabela com uma linha por componente BIM:

- `IfcUrl`
- `GlobalId`
- `Status`
- `IndicadorNumerico`
- `Descricao`

Associe `IfcUrl`, `GlobalId`, `IndicadorNumerico` e `Descricao` aos campos correspondentes do visual.
