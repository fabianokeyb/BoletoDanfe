-- Fase 1 da "lista sagrada": cards de pedido de compra, multiusuário.
-- Projeto Supabase THBT. Tudo nasce com conta_id (plano multiempresa); sem policies de RLS,
-- o acesso é só pelas funções SECURITY DEFINER abaixo, que exigem o token do aparelho
-- (escopo 'compras', o mesmo de public.compras_precos).
-- Toda gravação passa por public.pedido_salvar, que grava compras.pedido_alteracao: é a base
-- do controle de alterações (regras de quem pode editar o quê entram nessa função depois).

create schema if not exists compras;
revoke all on schema compras from public, anon, authenticated;

-- Pessoas autorizadas a criar e editar pedidos (até existir o login do plano multiempresa).
create table compras.pessoa (
  id int generated always as identity primary key,
  conta_id int not null default 1,
  nome text not null check (length(trim(nome)) > 0),
  ativo boolean not null default true,
  pode_pedir boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (conta_id, nome)
);
comment on table compras.pessoa is 'Quem pode criar e editar cards de pedido. Interino até o login (acesso.membro) do plano multiempresa.';

create table compras.pedido (
  id text primary key check (length(id) between 8 and 40),
  conta_id int not null default 1,
  numero int not null,
  solicitante_id int not null references compras.pessoa(id),
  criado_em timestamptz not null default now(),
  situacao text not null default 'rascunho'
    check (situacao in ('rascunho', 'enviado', 'em_andamento', 'fechado', 'cancelado')),
  fornecedor text not null default '',
  vendedor text not null default '',
  observacao text not null default '',
  versao int not null default 1,
  enviado_em timestamptz,
  atualizado_por int not null references compras.pessoa(id),
  atualizado_em timestamptz not null default now(),
  unique (conta_id, numero)
);
comment on table compras.pedido is 'Card de pedido de compra (ocorrência). A versão do envio é a lista sagrada (compras.pedido_versao).';

create table compras.pedido_loja (
  pedido_id text not null references compras.pedido(id) on delete cascade,
  loja_id int not null references cadastro.empresa(id),
  primary key (pedido_id, loja_id)
);

create table compras.pedido_item (
  id bigint generated always as identity primary key,
  pedido_id text not null references compras.pedido(id) on delete cascade,
  linha text not null,
  loja_id int not null references cadastro.empresa(id),
  catalogo_id text,
  descricao text not null check (length(trim(descricao)) > 0),
  unidade text not null default '',
  grupo text,
  fornecedor text,
  qtd numeric(12, 3) not null check (qtd > 0),
  unique (pedido_id, linha, loja_id)
);
comment on table compras.pedido_item is 'Linha da lista por loja. linha = id estável do item no card (nasce no aparelho).';

create table compras.pedido_alteracao (
  id bigint generated always as identity primary key,
  pedido_id text not null references compras.pedido(id) on delete cascade,
  versao int not null,
  autor_id int not null references compras.pessoa(id),
  em timestamptz not null default now(),
  acao text not null check (acao in ('criou', 'editou', 'incluiu', 'removeu', 'editou item')),
  campo text,
  linha_id text,
  linha text,
  loja_id int,
  antes jsonb,
  depois jsonb,
  motivo text
);
create index on compras.pedido_alteracao (pedido_id, versao);
comment on table compras.pedido_alteracao is 'Registro de alterações do card: só acrescentado. motivo fica vazio até existir o controle de alterações.';

create table compras.pedido_versao (
  pedido_id text not null references compras.pedido(id) on delete cascade,
  versao int not null,
  tipo text not null check (tipo in ('envio', 'fechamento')),
  itens jsonb not null,
  em timestamptz not null default now(),
  por int not null references compras.pessoa(id),
  primary key (pedido_id, versao, tipo)
);
comment on table compras.pedido_versao is 'Foto do card em momentos-chave. A do envio é a lista sagrada contra a qual as etapas conferem.';

alter table compras.pessoa enable row level security;
alter table compras.pedido enable row level security;
alter table compras.pedido_loja enable row level security;
alter table compras.pedido_item enable row level security;
alter table compras.pedido_alteracao enable row level security;
alter table compras.pedido_versao enable row level security;

insert into compras.pessoa (nome) values ('Fabiano');

-- ------------------------------------------------------------------ token

-- Conta do token de escopo 'compras' (erro 'token inválido' se não vale).
-- __TOKEN_CHECK__ é preenchido conforme integracao.app_token (mesma regra de compras_precos).
create or replace function compras._conta(p_token text) returns int
language plpgsql stable security definer set search_path = '' as $$
begin
  __TOKEN_CHECK__
  return 1;
end $$;
revoke all on function compras._conta(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ leitura

create or replace function public.pedidos_contexto(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conta int := compras._conta(p_token);
begin
  return jsonb_build_object(
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome)
                         from compras.pessoa where conta_id = v_conta and ativo and pode_pedir), '[]'::jsonb),
    'lojas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'sigla', e.sigla, 'nome', e.nome) order by e.id)
                       from cadastro.empresa e), '[]'::jsonb));
end $$;

create or replace function public.pedidos_listar(p_token text, p_todos boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conta int := compras._conta(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'solicitante', s.nome, 'criado_em', p.criado_em, 'situacao', p.situacao,
      'lojas', coalesce((select jsonb_agg(l.loja_id order by l.loja_id) from compras.pedido_loja l where l.pedido_id = p.id), '[]'::jsonb),
      'itens', (select count(distinct i.linha) from compras.pedido_item i where i.pedido_id = p.id),
      'fornecedores', (select count(distinct coalesce(nullif(i.fornecedor, ''), nullif(p.fornecedor, '')))
                       from compras.pedido_item i where i.pedido_id = p.id),
      'atualizado_por', a.nome, 'atualizado_em', p.atualizado_em
    ) order by p.atualizado_em desc)
    from compras.pedido p
    join compras.pessoa s on s.id = p.solicitante_id
    join compras.pessoa a on a.id = p.atualizado_por
    where p.conta_id = v_conta and (p_todos or p.situacao not in ('fechado', 'cancelado'))
  ), '[]'::jsonb);
end $$;

create or replace function public.pedido_abrir(p_token text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conta int := compras._conta(p_token); v jsonb;
begin
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'solicitante_id', p.solicitante_id, 'solicitante', s.nome, 'criado_em', p.criado_em,
    'situacao', p.situacao, 'fornecedor', p.fornecedor, 'vendedor', p.vendedor, 'observacao', p.observacao,
    'versao', p.versao, 'atualizado_por', a.nome, 'atualizado_em', p.atualizado_em,
    'lojas', coalesce((select jsonb_agg(l.loja_id order by l.loja_id) from compras.pedido_loja l where l.pedido_id = p.id), '[]'::jsonb))
  into v
  from compras.pedido p
  join compras.pessoa s on s.id = p.solicitante_id
  join compras.pessoa a on a.id = p.atualizado_por
  where p.id = p_id and p.conta_id = v_conta;
  if v is null then raise exception 'pedido não encontrado'; end if;
  return jsonb_build_object(
    'pedido', v,
    'itens', coalesce((select jsonb_agg(jsonb_build_object('linha', i.linha, 'loja_id', i.loja_id, 'catalogo_id', i.catalogo_id,
                         'descricao', i.descricao, 'unidade', i.unidade, 'grupo', i.grupo, 'fornecedor', i.fornecedor, 'qtd', i.qtd) order by i.id)
                       from compras.pedido_item i where i.pedido_id = p_id), '[]'::jsonb),
    'alteracoes', coalesce((select jsonb_agg(jsonb_build_object('versao', x.versao, 'autor', pe.nome, 'em', x.em, 'acao', x.acao,
                              'campo', x.campo, 'linha', x.linha, 'loja_id', x.loja_id, 'antes', x.antes, 'depois', x.depois) order by x.id desc)
                            from compras.pedido_alteracao x join compras.pessoa pe on pe.id = x.autor_id where x.pedido_id = p_id), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ gravação

create or replace function public.pedido_salvar(p_token text, p_pessoa int, p_pedido jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_conta int := compras._conta(p_token);
  v_id text := p_pedido->>'id';
  v_versao_cliente int := coalesce((p_pedido->>'versao')::int, 0);
  v_atual compras.pedido;
  v_nova int;
  v_numero int;
  v_situacao text := coalesce(p_pedido->>'situacao', 'rascunho');
  v_lojas int[] := coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(p_pedido->'lojas', '[]')) x), '{}');
  v_lojas_antes int[];
  v_mudou int := 0;
  n int;
begin
  if not exists (select 1 from compras.pessoa where id = p_pessoa and conta_id = v_conta and ativo and pode_pedir) then
    raise exception 'pessoa não autorizada a fazer pedidos';
  end if;
  if v_id is null or length(v_id) not between 8 and 40 then raise exception 'pedido sem id válido'; end if;
  if v_situacao not in ('rascunho', 'enviado', 'em_andamento', 'fechado', 'cancelado') then raise exception 'situação inválida'; end if;
  if cardinality(v_lojas) = 0 then raise exception 'pedido sem loja'; end if;
  if exists (select 1 from unnest(v_lojas) l where not exists (select 1 from cadastro.empresa e where e.id = l)) then
    raise exception 'loja inválida';
  end if;

  create temp table _itens on commit drop as
  select * from jsonb_to_recordset(coalesce(p_pedido->'itens', '[]'))
    as t(linha text, loja_id int, catalogo_id text, descricao text, unidade text, grupo text, fornecedor text, qtd numeric);
  if exists (select 1 from _itens where linha is null or loja_id is null or not (loja_id = any (v_lojas))
             or coalesce(trim(descricao), '') = '' or qtd is null or qtd <= 0) then
    raise exception 'item inválido no pedido';
  end if;
  if exists (select 1 from _itens group by linha, loja_id having count(*) > 1) then raise exception 'item repetido no pedido'; end if;

  select * into v_atual from compras.pedido where id = v_id for update;

  if v_atual.id is null then
    if v_versao_cliente <> 0 then raise exception 'pedido não encontrado'; end if;
    perform pg_advisory_xact_lock(hashtext('compras.pedido.numero'), v_conta);
    select coalesce(max(numero), 0) + 1 into v_numero from compras.pedido where conta_id = v_conta;
    insert into compras.pedido (id, conta_id, numero, solicitante_id, situacao, fornecedor, vendedor, observacao, versao,
                                enviado_em, atualizado_por)
    values (v_id, v_conta, v_numero, p_pessoa, v_situacao, coalesce(trim(p_pedido->>'fornecedor'), ''),
            coalesce(trim(p_pedido->>'vendedor'), ''), coalesce(trim(p_pedido->>'observacao'), ''), 1,
            case when v_situacao = 'enviado' then now() end, p_pessoa);
    insert into compras.pedido_loja select v_id, unnest(v_lojas);
    insert into compras.pedido_item (pedido_id, linha, loja_id, catalogo_id, descricao, unidade, grupo, fornecedor, qtd)
    select v_id, linha, loja_id, catalogo_id, trim(descricao), coalesce(trim(unidade), ''), grupo, nullif(trim(fornecedor), ''), qtd from _itens;
    insert into compras.pedido_alteracao (pedido_id, versao, autor_id, acao, depois)
    values (v_id, 1, p_pessoa, 'criou', jsonb_build_object('lojas', to_jsonb(v_lojas), 'itens', (select count(distinct linha) from _itens)));
    v_nova := 1;
  else
    if v_atual.conta_id <> v_conta then raise exception 'pedido não encontrado'; end if;
    if v_atual.versao <> v_versao_cliente then
      raise exception 'conflito: o pedido está na versão %, o aparelho editou a %', v_atual.versao, v_versao_cliente;
    end if;
    v_nova := v_atual.versao + 1;

    -- cabeçalho
    insert into compras.pedido_alteracao (pedido_id, versao, autor_id, acao, campo, antes, depois)
    select v_id, v_nova, p_pessoa, 'editou', c.campo, to_jsonb(c.antes), to_jsonb(c.depois)
    from (values ('situacao', v_atual.situacao, v_situacao),
                 ('fornecedor', v_atual.fornecedor, coalesce(trim(p_pedido->>'fornecedor'), '')),
                 ('vendedor', v_atual.vendedor, coalesce(trim(p_pedido->>'vendedor'), '')),
                 ('observacao', v_atual.observacao, coalesce(trim(p_pedido->>'observacao'), ''))) c(campo, antes, depois)
    where c.antes is distinct from c.depois;
    get diagnostics n = row_count; v_mudou := v_mudou + n;

    select coalesce(array_agg(loja_id order by loja_id), '{}') into v_lojas_antes from compras.pedido_loja where pedido_id = v_id;
    if v_lojas_antes <> v_lojas then
      insert into compras.pedido_alteracao (pedido_id, versao, autor_id, acao, campo, antes, depois)
      values (v_id, v_nova, p_pessoa, 'editou', 'lojas', to_jsonb(v_lojas_antes), to_jsonb(v_lojas));
      v_mudou := v_mudou + 1;
    end if;

    -- itens: incluídos, removidos e campos mudados, por linha × loja
    insert into compras.pedido_alteracao (pedido_id, versao, autor_id, acao, campo, linha_id, linha, loja_id, antes, depois)
    select v_id, v_nova, p_pessoa, d.acao, d.campo, d.linha_id, d.linha, d.loja_id, d.antes, d.depois
    from (
      select 'incluiu' acao, null campo, n.linha linha_id, trim(n.descricao) linha, n.loja_id, null::jsonb antes, to_jsonb(n.qtd) depois
      from _itens n where not exists (select 1 from compras.pedido_item o where o.pedido_id = v_id and o.linha = n.linha and o.loja_id = n.loja_id)
      union all
      select 'removeu', null, o.linha, o.descricao, o.loja_id, to_jsonb(o.qtd), null
      from compras.pedido_item o where o.pedido_id = v_id
        and not exists (select 1 from _itens n where n.linha = o.linha and n.loja_id = o.loja_id)
      union all
      select 'editou item', c.campo, o.linha, o.descricao, o.loja_id, c.antes, c.depois
      from compras.pedido_item o join _itens n on n.linha = o.linha and n.loja_id = o.loja_id
      cross join lateral (values
        ('qtd', to_jsonb(o.qtd), to_jsonb(n.qtd)),
        ('descricao', to_jsonb(o.descricao), to_jsonb(trim(n.descricao))),
        ('unidade', to_jsonb(o.unidade), to_jsonb(coalesce(trim(n.unidade), ''))),
        ('fornecedor', to_jsonb(o.fornecedor), to_jsonb(nullif(trim(n.fornecedor), '')))) c(campo, antes, depois)
      where o.pedido_id = v_id and c.antes is distinct from c.depois
        and not (c.campo = 'qtd' and o.qtd = n.qtd)
    ) d;
    get diagnostics n = row_count; v_mudou := v_mudou + n;

    if v_mudou = 0 then
      return jsonb_build_object('id', v_id, 'numero', v_atual.numero, 'versao', v_atual.versao);
    end if;

    update compras.pedido set situacao = v_situacao, fornecedor = coalesce(trim(p_pedido->>'fornecedor'), ''),
      vendedor = coalesce(trim(p_pedido->>'vendedor'), ''), observacao = coalesce(trim(p_pedido->>'observacao'), ''),
      versao = v_nova, atualizado_por = p_pessoa, atualizado_em = now(),
      enviado_em = case when v_situacao = 'enviado' and v_atual.situacao <> 'enviado' then now() else enviado_em end
    where id = v_id;
    delete from compras.pedido_loja where pedido_id = v_id;
    insert into compras.pedido_loja select v_id, unnest(v_lojas);
    delete from compras.pedido_item where pedido_id = v_id;
    insert into compras.pedido_item (pedido_id, linha, loja_id, catalogo_id, descricao, unidade, grupo, fornecedor, qtd)
    select v_id, linha, loja_id, catalogo_id, trim(descricao), coalesce(trim(unidade), ''), grupo, nullif(trim(fornecedor), ''), qtd from _itens;
    v_numero := v_atual.numero;
  end if;

  -- passou para enviado agora: congela a lista sagrada
  if v_situacao = 'enviado' and (v_atual.id is null or v_atual.situacao <> 'enviado') then
    insert into compras.pedido_versao (pedido_id, versao, tipo, itens, por)
    values (v_id, v_nova, 'envio', (select coalesce(jsonb_agg(to_jsonb(i) - 'id' - 'pedido_id' order by i.id), '[]') from compras.pedido_item i where i.pedido_id = v_id), p_pessoa)
    on conflict do nothing;
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'versao', v_nova);
end $$;

revoke all on function public.pedidos_contexto(text) from public;
revoke all on function public.pedidos_listar(text, boolean) from public;
revoke all on function public.pedido_abrir(text, text) from public;
revoke all on function public.pedido_salvar(text, int, jsonb) from public;
grant execute on function public.pedidos_contexto(text) to anon, authenticated;
grant execute on function public.pedidos_listar(text, boolean) to anon, authenticated;
grant execute on function public.pedido_abrir(text, text) to anon, authenticated;
grant execute on function public.pedido_salvar(text, int, jsonb) to anon, authenticated;
