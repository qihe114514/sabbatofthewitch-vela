import { SCN_TYPE } from '../../common/reader-constants.js'
import { runtimeData } from '../../common/runtime-data.js'

const fastForwardDelay = 50

// 指令流引擎核心：脚本推进、打字机、背景/SD 立绘、选项与好感度、章节路由
export default {
  // —— 背景 ——
  updateBackground(bg) {
    this.currentBg = bg
  },

  // —— SD 立绘 / 事件CG ——
  updateEV(evImage) {
    if (evImage === null) {
      this.currentEV = ''
      this.currentSD = ''
      return
    }
    if (evImage.startsWith('sd')) {
      this.currentSD = evImage
      this.currentEV = ''
    } else if (evImage.startsWith('ev')) {
      // 事件CG未提取，跳过显示，仅记录
      this.currentEV = ''
      this.currentSD = ''
    }
  },

  // —— 章节标题 ——
  updateChapterTitle(title) {
    this.currentChapterName = title
  },

  // —— 跳转到下一章节 ——
  getNextScn(currentId) {
    const SCN_LIST = runtimeData.sceneList
    if (currentId === '020_nene') return SCN_LIST.nene[0]
    if (currentId === '020_meguru') return SCN_LIST.meguru[0]
    if (currentId === '020_tsumugi') return SCN_LIST.tsumugi[0]
    if (currentId === '020_akogare') return SCN_LIST.akogare[0]

    const commonList = SCN_LIST.common
    const commonIdx = commonList.findIndex((i) => i.id === currentId)
    if (commonIdx !== -1) {
      if (currentId === '019') {
        const route = this.determineRoute()
        switch (route) {
          case 'nene': return commonList.find((i) => i.id === '020_nene')
          case 'meguru': return commonList.find((i) => i.id === '020_meguru')
          case 'tsumugi': return commonList.find((i) => i.id === '020_tsumugi')
          case 'akogare': return commonList.find((i) => i.id === '020_akogare')
          case 'wakana': return SCN_LIST.wakana[0]
          default: return commonList[commonIdx + 1]
        }
      }
      return commonList[commonIdx + 1] || null
    }

    const routes = ['nene', 'meguru', 'tsumugi', 'akogare', 'wakana']
    for (const route of routes) {
      const list = SCN_LIST[route]
      if (!list) continue
      const index = list.findIndex((i) => i.id === currentId)
      if (index !== -1) return list[index + 1] || null
    }
    return null
  },

  // —— 好感度选线 ——
  determineRoute() {
    const flags = this.gameFlags
    const flagScores = [
      { id: 'nene', score: flags.nen_flag || 0 },
      { id: 'meguru', score: flags.meg_flag || 0 },
      { id: 'tsumugi', score: flags.tsu_flag || 0 },
      { id: 'akogare', score: flags.tou_flag || 0 },
      { id: 'wakana', score: flags.wak_flag || 0 }
    ]
    flagScores.sort((a, b) => b.score - a.score)
    if (flagScores[0].score === 0) return null
    if (flagScores[0].score === flagScores[1].score) return null
    return flagScores[0].id
  },

  // —— 解析表达式 ——
  runExp(expStr) {
    if (!expStr) return
    const parts = expStr.split(',')
    parts.forEach((part) => {
      let cmd = part.trim()
      try {
        if (cmd.includes('++')) {
          const varName = cmd.replace('f.', '').replace('++', '').trim()
          this.gameFlags[varName] = (this.gameFlags[varName] || 0) + 1
        } else if (cmd.includes('--')) {
          const varName = cmd.replace('f.', '').replace('--', '').trim()
          this.gameFlags[varName] = (this.gameFlags[varName] || 0) - 1
        } else if (cmd.includes('=')) {
          let [varName, val] = cmd.split('=')
          varName = varName.replace('f.', '').trim()
          val = val.trim()
          const numVal = parseInt(val, 10)
          this.gameFlags[varName] = isNaN(numVal) ? val : numVal
        }
      } catch (e) {}
    })
  },

  // —— 显示下一行 ——
  showLine() {
    if (!this.scriptData || this.scriptData.length === 0) return
    const node = this.scriptData[this.currentLineIndex]
    if (!node) { this.goToNextScenario(); return }

    const type = node[0]
    const content = node[1]

    switch (type) {
      case SCN_TYPE.BACKGROUND:
        this.updateBackground(content)
        this.currentLineIndex++
        this.showLine()
        break
      case SCN_TYPE.DIALOGUE:
        this.currentSpeaker = content || ''
        this.fullText = node[2] || ''
        this.currentCharacters = node.length > 3 ? node[3] : null
        this.displayText = ''
        this.isTextComplete = false
        this.currentCharIndex = 0
        if (this.isFastForwarding) {
          this.displayText = this.fullText
          this.isTextComplete = true
          this.clearFastForwardTimer()
          this.fastForwardTimer = setTimeout(() => {
            this.currentLineIndex++
            this.showLine()
          }, fastForwardDelay)
        } else {
          this.showTypeWriterEffect()
        }
        break
      case SCN_TYPE.SELECT:
        this.currentOptions = content
        this.showOptions = true
        break
      case SCN_TYPE.CHAPTER_TITLE:
        this.updateChapterTitle(content)
        this.currentLineIndex++
        this.showLine()
        break
      case SCN_TYPE.NEXT: {
        const targetLabel = content
        const jumpIndex = this.scriptData.findIndex(
          (item) => item[0] === SCN_TYPE.LABEL && item[1] === targetLabel
        )
        if (jumpIndex !== -1) {
          this.currentLineIndex = jumpIndex
          this.showLine()
        } else {
          this.currentLineIndex++
          this.showLine()
        }
        break
      }
      case SCN_TYPE.LABEL:
        this.currentLineIndex++
        this.showLine()
        break
      case SCN_TYPE.EV:
        this.updateEV(content)
        this.currentLineIndex++
        this.showLine()
        break
    }
  },

  // —— 打字机 ——
  showTypeWriterEffect() {
    this.clearTimer()
    if (this.currentCharIndex === 0) {
      const scroll = this.$element('dialogueScroll')
      if (scroll) scroll.scrollTo({ top: 0, behavior: 'instant' })
    }
    if (this.currentCharIndex < this.fullText.length) {
      this.displayText += this.fullText.charAt(this.currentCharIndex)
      this.currentCharIndex++
      const speed = this.isFastForwarding ? 2 : this.settings.textSpeed
      this.typeWriterTimer = setTimeout(() => this.showTypeWriterEffect(), speed)
      if (this.currentCharIndex % 5 === 0 && this.displayText.length > 20) {
        const scroll = this.$element('dialogueScroll')
        if (scroll) scroll.scrollTo({ top: 9999, behavior: 'instant' })
      }
    } else {
      this.finishText()
    }
  },

  finishText() {
    this.clearTimer()
    this.displayText = this.fullText
    this.isTextComplete = true
  },

  clearTimer() {
    if (this.typeWriterTimer) {
      clearTimeout(this.typeWriterTimer)
      this.typeWriterTimer = null
    }
  },

  clearFastForwardTimer() {
    if (this.fastForwardTimer) {
      clearTimeout(this.fastForwardTimer)
      this.fastForwardTimer = null
    }
  },

  // —— 快进：跨段跳过直到下一个选项 ——
  skipUntilSelect() {
    if (!this.scriptData || this.scriptData.length === 0) return
    this.currentEV = ''
    this.currentSD = ''
    this.isSkipping = true
    let lastDialogueNode = null
    while (this.currentLineIndex < this.scriptData.length) {
      const node = this.scriptData[this.currentLineIndex]
      const type = node[0]
      const content = node[1]
      switch (type) {
        case SCN_TYPE.SELECT:
          if (lastDialogueNode) {
            this.currentSpeaker = lastDialogueNode[1] || ''
            this.fullText = lastDialogueNode[2] || ''
            this.displayText = this.fullText
            this.isTextComplete = true
          }
          this.isSkipping = false
          this.currentOptions = content
          this.showOptions = true
          this.isTextComplete = true
          return
        case SCN_TYPE.DIALOGUE:
          lastDialogueNode = node
          break
        case SCN_TYPE.BACKGROUND:
          this.updateBackground(content)
          break
        case SCN_TYPE.CHAPTER_TITLE:
          this.updateChapterTitle(content)
          break
        case SCN_TYPE.EV:
          this.updateEV(content)
          break
        default:
          break
      }
      this.currentLineIndex++
    }
    if (this.currentLineIndex >= this.scriptData.length) {
      this.goToNextScenario()
    }
  },

  // —— 快进按钮 ——
  doFastForward() {
    if (this.showOptions) return
    const scroll = this.$element('dialogueScroll')
    if (scroll) scroll.scrollTo({ top: 0, behavior: 'instant' })
    this.isFastForwarding = true
    if (this.isTextComplete) {
      this.currentLineIndex++
      this.showLine()
    } else {
      this.displayText = this.fullText
      this.isTextComplete = true
      this.clearTimer()
      this.clearFastForwardTimer()
      this.fastForwardTimer = setTimeout(() => {
        this.currentLineIndex++
        this.showLine()
      }, 20)
    }
  },

  stopFastForward() {
    this.isFastForwarding = false
    this.clearFastForwardTimer()
  }
}
