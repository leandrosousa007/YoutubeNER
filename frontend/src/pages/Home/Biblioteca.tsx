import { Button } from '../../components/Button/Button'
import { Icon } from '../../components/Icon/Icon'
import { apiColecao, type Colecao, type Usuario } from '../../features/anotacao/api'
import s from './Dashboard.module.css'

type Props = { colecoes: Colecao[]; abrir: (colecao: Colecao) => void; usuario: Usuario | null }
const numero = (n: number) => n.toLocaleString('pt-BR')

export function Biblioteca({ colecoes, abrir, usuario }: Props) {
  const total = colecoes.reduce((soma, c) => soma + c.total, 0)
  const revisados = colecoes.reduce((soma, c) => soma + c.revisados, 0)
  const percentual = total ? revisados / total * 100 : 0
  const principal = colecoes.find(c => c.revisados < c.total) ?? colecoes[0]
  return <div className={s.dashboard}>
    <section className={s.hero} aria-labelledby="inicio-titulo">
      <div className={s.introduction}>
        <h1 id="inicio-titulo">Estúdio de<br />anotação</h1>
        <p className={s.description}>Selecione um trecho, marque a entidade e avance para o próximo comentário.</p>
        <div className={s.heroActions}>
          <Button disabled={!principal} onClick={() => principal && abrir(principal)}>Continuar anotação <Icon name="right" width="18" height="18" /></Button>
          <a href="#acervo">Explorar acervo <span aria-hidden="true">↓</span></a>
        </div>
        <p className={s.microcopy}><Icon name="check" width="15" height="15" />Marcações salvas automaticamente</p>
      </div>
      <div className={s.preview} aria-label="Exemplo ilustrativo de anotação">
        <div className={s.previewTop}><span className={s.previewIcon}><Icon name="annotate" /></span><span>Bancada de anotação<small>Prévia do comentário</small></span><span className={s.saved}>Salvo <Icon name="check" width="13" height="13" /></span></div>
        <div className={s.previewText}><span className={s.exampleLabel}>EXEMPLO DE ANOTAÇÃO</span><p><mark data-label="PERSON">Ana</mark> começou a fazer<br /><mark data-label="EXERCISE">caminhada</mark> por <mark data-label="DURATION">30 minutos</mark>.</p></div>
        <div className={s.previewBottom}><span><span />3 entidades identificadas</span></div>
      </div>
    </section>
    <section className={s.overview} aria-label="Progresso do projeto">
      <div className={s.overviewTitle}><span className={s.sectionIcon}><Icon name="list" /></span><div><h2>Progresso da revisão</h2></div></div>
      <dl className={s.stats}>
        <div><dt>Comentários no acervo</dt><dd>{numero(total)}</dd></div>
        <div><dt>Revisados</dt><dd>{numero(revisados)}<small> / {numero(total)}</small></dd></div>
        <div><dt>Progresso geral</dt><dd>{percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}<small>%</small></dd></div>
      </dl>
      <progress className={s.totalProgress} value={revisados} max={total || 1} aria-label="Progresso geral de revisão" />
    </section>
    <section id="acervo" className={s.corpus} aria-labelledby="acervo-titulo">
      <header className={s.sectionHead}><div><h2 id="acervo-titulo">Seu acervo</h2></div><span>{colecoes.length} {colecoes.length === 1 ? 'coleção' : 'coleções'} · Textos originais preservados</span></header>
      {!colecoes.length ? <p className={s.empty}>O acervo ainda não foi preparado. Consulte as instruções de instalação do projeto.</p> : <ul className={s.collections}>{colecoes.map(c => <li key={c.id}>
        <div className={s.collectionTop}><span className={s.folder}><Icon name="folder" width="25" height="25" /></span><span className={s.collectionBadge}>ACERVO FIXO</span></div>
        <h3>{c.nome.replace(/PostgreSQL/gi, 'Comentários')}</h3><p>{numero(c.total)} comentários para explorar</p>
        <div className={s.collectionProgress}><span>{numero(c.revisados)} revisados</span><strong>{(c.total ? c.revisados / c.total * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong></div>
        <progress value={c.revisados} max={c.total || 1} aria-label={'Revisão de ' + c.nome} />
        <div className={s.collectionActions}><Button variant="secondary" onClick={() => abrir(c)}>Abrir bancada <Icon name="right" width="16" height="16" /></Button>{usuario?.papel !== 'anotador' && <a href={apiColecao(c.id) + '/csv'} aria-label={'Baixar comentários de ' + c.nome}><Icon name="download" width="17" height="17" /> CSV</a>}</div>
      </li>)}</ul>}
    </section>

  </div>
}
