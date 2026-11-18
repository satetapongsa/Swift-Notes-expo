/**
 * AIService.js
 * Central service to handle all AI-related logic in SwiftNote.
 * Responses are mocked for now. A real model must be called from the server
 * (an /api route) so that no API key ever ships in the app bundle.
 */

class AIService {
  /**
   * Helper to simulate AI response delay and logic
   * In production, this will be a real fetch call.
   */
  async generateResponse(prompt, context = '') {
    console.log('AI Logic Triggered with prompt:', prompt);
    
    // Simulate Network Latency
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Mock logic based on keywords
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('summarize')) {
      return "Sure! Based on your note, the key points are: 1. Improving UI/UX performance, 2. Implementing AI for automation, and 3. Enhancing cross-device sync.";
    }
    
    if (lowerPrompt.includes('title')) {
      return "I suggest the title: 'Strategizing SwiftNote's Future'.";
    }

    return "Hello! I am your SwiftNote AI assistant. I've analyzed your notes and I'm ready to help you organize your thoughts better. What would you like to do next?";
  }

  /**
   * Summarize a whole note content
   */
  async summarizeNote(content) {
    return this.generateResponse(`Please summarize the following note content for me: ${content}`, content);
  }

  /**
   * Suggest tags based on content
   */
  async suggestTags(content) {
    // Future implementation for real API
    return ['Work', 'Ideas', 'AI-Generated'];
  }
}

export default new AIService();
