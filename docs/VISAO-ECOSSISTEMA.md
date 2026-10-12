# Visão do Ecossistema — Escala do Reino
## Da Escala Litúrgica ao Sistema de Saúde Integral da Igreja (Church Health OS)

**Autor / Concepção de Produto:** Product Manager com 14 anos de experiência em produto e 21 anos de ministério prático nos bastidores da igreja.  
**Data de Consolidação da Visão:** 11 de outubro de 2026.  
**Piloto Inicial:** Ministério Shalom (focado no MVP de Escalas e Culto ao Vivo).  
**Natureza do Documento:** Manifesto de Produto, Arquitetura Funcional e Visão Estratégica de Longo Prazo.

---

## 1. O Manifesto: Por que o Escala do Reino existe?

A maioria dos softwares de igreja no mercado trata a congregação como um cadastro de clientes e uma régua de cobrança financeira (quantos entraram, quantos saíram, quanto pagaram). Quase nenhum foi desenhado por quem realmente viveu a rotina do altar, da cabine de som, da portaria, das reuniões de célula e dos bastidores do culto.

Durante décadas, as igrejas aprenderam a resolver seus maiores desafios **"na raça"**:
* Líderes sobrecarregados virando coringas e acumulando funções;
* Informações espalhadas em dezenas de grupos de WhatsApp, planilhas de Excel e envelopes de papel;
* **A epidemia silenciosa do burnout pastoral:** pastores altamente capacitados — mesmo profissionais com formação sólida e preparo emocional — parando em hospitais por exaustão e sobrecarga de microgestão;
* Ovelhas se afastando silenciosamente em crises de depressão ou esfriamento sem que a liderança perceba a tempo;
* Falta de critérios transparentes para reconhecer quem realmente serve com fidelidade na hora das consagrações.

> **Propósito Central:**  
> O *Escala do Reino* não existe para substituir o contato humano ou transformar a igreja em algo virtual. Ele existe para que as **atividades físicas da igreja fluam com segurança, rastreabilidade, paz e confiabilidade**, protegendo a saúde do pastor, dando clareza aos líderes e fazendo cada membro se sentir cuidado e pertencente ao Corpo.

---

## 2. A Filosofia de Engenharia e Produto

1. **Tecnologia Invisível a Serviço do Encontro Presencial:**  
   O sistema opera nos bastidores para que, no momento do culto, da célula ou do retiro, as pessoas estejam 100% presentes em comunhão e adoração, sem correrias ou imprevistos evitáveis.
2. **Dados como Instrumento de Cuidado, Nunca de Punição:**  
   Métricas de assiduidade e trocas de escala não existem para criar rankings punitivos ou constrangimento, mas como termômetros de saúde espiritual e emocional.
3. **Parametrização e Modularidade Total:**  
   Nenhuma igreja é igual à outra. Uma igreja de 50 membros precisa de simplicidade e rapidez; uma igreja de 2.000 membros precisa de governança, patrimônio e múltiplos departamentos. Tudo deve ser modular e configurável por parâmetros/permissões, permitindo vender ou ativar módulos isolados ou em conjunto.
4. **Estratégia da Cunha (Wedge Strategy):**  
   Entrar na igreja pela dor mais aguda e urgente (a organização das escalas e a condução do culto ao vivo) e expandir gradualmente para o ecossistema completo.

---

## 3. Os 6 Pilares Modulares do Ecossistema

```
                     ┌─────────────────────────────────────────────────┐
                     │          ESCALA DO REINO (CHURCH OS)            │
                     └───────────────────────┬─────────────────────────┘
                                             │
      ┌──────────────────┬───────────────────┼───────────────────┬──────────────────┐
      ▼                  ▼                   ▼                   ▼                  ▼
┌───────────┐      ┌───────────┐       ┌───────────┐       ┌───────────┐      ┌───────────┐
│  PILAR 1  │      │  PILAR 2  │       │  PILAR 3  │       │  PILAR 4  │      │  PILAR 5  │
│ Liturgia  │      │ Células & │       │ Saúde da  │       │ Eventos & │      │ Cursos &  │
│  & Culto  │      │Discipulado│       │ Liderança │       │Tesouraria │      │ Inclusão  │
└───────────┘      └───────────┘       └───────────┘       └───────────┘      └───────────┘
                                             │
                                             ▼
                                       ┌───────────┐
                                       │  PILAR 6  │
                                       │Patrimônio │
                                       │& Manutenç.│
                                       └───────────┘
```

---

### PILAR 1: Saúde Litúrgica & Condução do Culto ao Vivo (O Core do MVP)

O coração operacional do culto presencial, desenhado com respeito absoluto à dinâmica litúrgica:

* **Console ao Vivo da Liturgia (Live Console):**
  * Cronômetro regressivo por etapa que **não avança o culto sozinho** ao zerar (o mover espiritual e as ministrações têm soberania; o sistema aponta o tempo excedido em destaque visual sem bloquear a programação);
  * Devolução para pendente preservando a tentativa e reiniciando com a duração prevista cheia (ideal para interrupções técnicas ou inversões de ordem);
  * Cancelamento de atividade com motivo pré-cadastrado no histórico da liturgia;
  * Correção de horários reais recalculando durações e preservando histórico.
* **Escalas Nominais e Prevenção de Conflitos:**
  * Bloqueio inteligente de conflitos de funções simultâneas (ex: a mesma pessoa escalada na dança e no canto no mesmo bloco);
  * Visão personalizada "Minha Escala" para cada voluntário no celular, com músicas, tom e notas de ensaio.
* **Cultos Oficiais vs. Recorrência Perene:**
  * Cultos que nunca param independente de feriados civis (ex: cultos oficiais de quarta-feira, sábado e domingo), com geração recorrente de escalas.
* **Botão de Apoio da Portaria / Recepção (Segurança & Intercessão):**
  * O porteiro ou recepcionista fica na linha de frente na calçada enquanto o culto ocorre com som alto no santuário.
  * Acionamento silencioso via celular com dois destinos imediatos:
    1. 🚨 **Apoio de Segurança / Diaconia:** Aciona homens do ministério de apoio/portaria que estão no culto para descerem discretamente e desescalarem conflitos (pessoas alteradas ou embriagadas).
    2. 🙏 **Apoio Pastoral / Intercessão:** Aciona intercessores ou obreiros escalados para acolhimento e oração reservada para pessoas em crise emocional ou luto que chegam na porta.

---

### PILAR 2: Saúde do Discipulado, Células e Retenção Pastoral

Cuidar de cada pessoa pelo nome, eliminando a dependência de papéis amassados e anotações perdidas:

* **Acompanhamento de Discipulado 1 a 1:**
  * Linhagem de cuidado clara: o discípulo sabe quem é seu discipulador de referência, e o discipulador tem a lista e o histórico de seus discípulos.
* **Gestão de Células / Cultos no Lar:**
  * **Ciclos semestrais definidos:** Temporadas com início e fim (ex: ciclos de 2 meses por semestre);
  * **Regra de Ouro de Rotação de Lares:** Algoritmo que alerta ou impede a repetição do mesmo endereço em ciclos consecutivos, forçando a comunhão a rodar pelas casas dos irmãos e evitando sobrecarregar uma única família anfitriã;
  * **Relatório Express de 10 Segundos:** Ao término da reunião, o líder responde no celular:
    1. *A reunião aconteceu?* (Se não, motivo obrigatório: chuva, imprevisto de saúde, etc.);
    2. *Onde aconteceu?* (Confirmação do endereço do anfitrião);
    3. *Quantas pessoas presentes?* (Membros + visitantes).
  * **Conferência de Dízimos e Ofertas de Célula:** O líder registra o valor arrecadado no app. No domingo, a coordenação de células faz a conferência rápida do envelope físico contra o valor registrado no sistema, eliminando desvios e papéis perdidos.
* **O Alerta Pastoral de 3 Faltas (Retenção Inteligente):**
  * Membros realizam check-in no culto (ou são marcados na portaria/célula);
  * Se um membro acumular **3 faltas consecutivas**, o sistema **não cobra o membro**, mas emite uma notificação de cuidado para o **seu líder direto** (líder de célula, líder de jovens ou Ministério de Capelania):
    > *"O irmão [Nome] não compareceu aos últimos 3 cultos. Que tal enviar uma mensagem ou fazer uma visita para saber se ele e a família estão bem?"*
  * Evita o afastamento silencioso de membros por depressão, enfermidade ou crises familiares.

---

### PILAR 3: Saúde da Liderança & Reconhecimento de Fidelidade

Proteger o pastor do esgotamento e estabelecer uma liderança saudável e transparente:

* **Alívio da Carga Mental do Pastor:**
  * Painel executivo de saúde da igreja: o pastor não precisa caçar informações no WhatsApp; ele abre o app e vê o pulso dos ministérios, das células e dos cultos em uma única tela.
  * Liderança de líderes: o pastor identifica se os coordenadores e líderes de departamentos estão realmente pastoreando seus liderados.
* **Detecção Precoce de Fadiga e Inconstância:**
  * O sistema identifica padrões: voluntários que estão trocando de escala com frequência anormal ou acumulando muitas escalas no mesmo mês.
  * O líder é orientado a intervir pastoralmente para descanso ou alívio de função antes que o voluntário queime por exaustão.
* **Consagração Baseada em Fidelidade e Histórico Real:**
  * Na escolha de novos **obreiros, diáconos e presbíteros**, substitui o compadrio e o "achismo" por dados históricos de dedicação e testemunho:
    * Histórico de assiduidade aos cultos ao longo dos anos;
    * Confiabilidade nas escalas (cumprimento de compromissos sem furos constantes);
    * Engajamento real nas células e eventos da igreja.

---

### PILAR 4: Saúde Financeira de Eventos & Tesouraria em Tempo Real

Eliminar o pesadelo das cobranças manuais em retiros, acampamentos e conferências:

* **O Funil de Eventos (Interesse ➔ Pagamento ➔ Caixa):**
  1. O membro sinaliza **"Tenho interesse em participar"**;
  2. O líder do evento visualiza a lista de inscritos e o status financeiro de cada um;
  3. O membro realiza o pagamento (Pix Copia-e-Cola / QR Code com baixa automática via webhook ou cartão);
  4. **Painel da Tesouraria em Tempo Real:**
     * *Total Previsto:* R$ 20.000,00
     * *Total Arrecadado e Disponível em Caixa:* R$ 13.500,00 (visibilidade para adiantar pagamentos do sítio, ônibus e alimentação)
     * *Saldo Pendente:* R$ 6.500,00 (lista exata de quem falta quitar).
* **Decisão Estratégica sobre o Dízimo:**
  * O dízimo regular do culto permanece fora desta fase para respeitar a cultura e a sensibilidade teológica da liderança, concentrando a solução na dor logística dos eventos, cursos e taxas operacionais.

---

### PILAR 5: Educação Cristã & Inclusão Digital (Cursos & Terceira Idade)

Democratizar o ensino bíblico com foco nas pessoas que têm dificuldade com tecnologia:

* **Cursos de Batismo, Doutrina, Casais e Escola Bíblica:**
  * Matrícula e controle de turmas com material didático e presenças.
* **Aulas em Vídeo com YouTube Não-Listado/Privado:**
  * Custo zero de largura de banda e hospedagem de vídeo (utiliza infraestrutura do YouTube).
* **Interface Exclusiva para a Terceira Idade (UX Acolhedora):**
  * Elimina a barreira de idosos se perderem no aplicativo do YouTube (com anúncios, comentários tóxicos e recomendações aleatórias).
  * No *Escala do Reino*: tela limpa, tipografia ampla, foto do professor, título direto (*"Aula 4: A Graça Salvadora"*) e um botão grande de **Assistir Aula**, sem nenhuma distração.

---

### PILAR 6: Patrimônio, Estoque e Manutenção Preventiva

Zelar pela infraestrutura física e equipamentos com boa mordomia dos recursos do Reino:

* **Inventário de Instrumentos e Equipamentos:**
  * Cadastro de instrumentos musicais, mesa de som, microfones, caixas acústicas, projetores e computadores de transmissão.
* **Manutenções Periódicas com Alertas Automáticos:**
  * Cronograma preventivo de afinação de instrumentos, limpeza de filtros de ar-condicionado, revisão elétrica e preventiva de som, evitando queimas caras e interrupções durante o culto.
* **Cadastro de Fornecedores de Confiança:**
  * Agenda centralizada de prestadores homologados pela igreja (técnicos de áudio, eletricistas, encanadores, gráfica, padaria da Santa Ceia).

---

## 4. Estratégia de Plataformas & Roadmap de Entrega

| Fase | Escopo & Entregas | Status |
|---|---|---|
| **Fase 1 (MVP Atual)** | • Identidade, Convites Seguros (72h), Criação de Igreja e Membros.<br>• Piloto das Escalas e Liturgia ao Vivo no **Ministério Shalom**.<br>• Web SPA Responsivo (Mobile-First para celular e desktop). | Em finalização / Testes de laboratório |
| **Fase 2 (Próximos 1-2 meses)** | • Aplicativo Android Nativo/Híbrido para consulta e operação ágil.<br>• Módulo de Cultos no Lar / Células (relatórios express e rotação de lares).<br>• Alerta pastoral de 3 faltas para líderes. | Planejado |
| **Fase 3** | • Pipeline Financeiro de Retiros e Eventos (Inscrição + Tesouraria).<br>• Cursos e Vídeos para Terceira Idade (YouTube integrado).<br>• Botão de Apoio da Portaria (Segurança e Intercessão). | Visão Estratégica |
| **Fase 4** | • Aplicativo iOS.<br>• Módulo de Patrimônio, Fornecedores e Manutenção Preventiva.<br>• Histórico e métricas de fidelidade para Consagrações de Obreiros. | Visão de Longo Prazo |

---

## 5. Resumo da Visão

> *"Não estamos construindo apenas linhas de código; estamos criando uma infraestrutura de paz e cuidado para pastores, líderes e membros. Queremos que a igreja seja forte no púlpito, organizada nos bastidores e acolhedora nas casas."*
